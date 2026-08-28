import asyncio
import heapq
import json
import math
import random
import time
from pathlib import Path

import mujoco
import numpy as np
import onnxruntime as ort
import websockets


ROOT = Path(__file__).resolve().parent
UNITREE = ROOT / "vendor" / "unitree_rl_mjlab"
MODEL = UNITREE / "src" / "assets" / "robots" / "unitree_g1" / "xmls" / "scene_g1.xml"
POLICY = UNITREE / "deploy" / "robots" / "g1" / "config" / "policy" / "velocity" / "v0" / "exported" / "policy.onnx"
MAX_BOXES = 20000
ACTIVE_BOXES = 1500
CELL = 0.5
BOX_SLOTS = [(0.25, 900), (0.5, 300), (1, 150), (2, 75), (4, 45), (8, 22), (16, 8)]

DEFAULT = np.array([
    -0.1, 0, 0, 0.3, -0.2, 0,
    -0.1, 0, 0, 0.3, -0.2, 0,
    0, 0, 0,
    0.35, 0.18, 0, 0.87, 0, 0, 0,
    0.35, -0.18, 0, 0.87, 0, 0, 0,
], dtype=np.float32)
SCALE = np.array([
    0.548, 0.351, 0.548, 0.351, 0.439, 0.439,
    0.548, 0.351, 0.548, 0.351, 0.439, 0.439,
    0.548, 0.439, 0.439,
    0.439, 0.439, 0.439, 0.439, 0.439, 0.075, 0.075,
    0.439, 0.439, 0.439, 0.439, 0.439, 0.075, 0.075,
], dtype=np.float32)
KP = np.array([
    40.179, 99.098, 40.179, 99.098, 28.501, 28.501,
    40.179, 99.098, 40.179, 99.098, 28.501, 28.501,
    40.179, 28.501, 28.501,
    14.251, 14.251, 14.251, 14.251, 14.251, 16.778, 16.778,
    14.251, 14.251, 14.251, 14.251, 14.251, 16.778, 16.778,
], dtype=np.float32)
KD = np.array([
    2.558, 6.309, 2.558, 6.309, 1.814, 1.814,
    2.558, 6.309, 2.558, 6.309, 1.814, 1.814,
    2.558, 1.814, 1.814,
    0.907, 0.907, 0.907, 0.907, 0.907, 1.068, 1.068,
    0.907, 0.907, 0.907, 0.907, 0.907, 1.068, 1.068,
], dtype=np.float32)
BASIS = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)


def rotate(q, vector):
    xyz = q[1:]
    return vector + 2 * np.cross(xyz, np.cross(xyz, vector) + q[0] * vector)


def quat_matrix(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def matrix_quat(matrix):
    quat = np.empty(4, dtype=np.float64)
    mujoco.mju_mat2Quat(quat, matrix.reshape(9))
    return quat


def split_box(center, half, quat):
    limit = BOX_SLOTS[-1][0]
    counts = np.maximum(np.ceil(half / limit).astype(int), 1)
    if np.all(counts == 1):
        return [(center, half, quat)]
    part = half / counts
    rotation = quat_matrix([quat[1], quat[2], quat[3], quat[0]])
    boxes = []
    for x in range(counts[0]):
        for y in range(counts[1]):
            for z in range(counts[2]):
                local = (np.array([x, y, z]) + 0.5 - counts / 2) * part * 2
                boxes.append((center + rotation @ local, part.copy(), quat.copy()))
    return boxes


class Robot:
    def __init__(self):
        if not MODEL.exists() or not POLICY.exists():
            raise SystemExit("Run robot/setup.sh first")
        spec = mujoco.MjSpec.from_file(str(MODEL))
        self.robot_count = len(spec.bodies) - 1
        spec.memory = 128 * 1024 * 1024
        slot_sizes = []
        for limit, count in BOX_SLOTS:
            for _ in range(count):
                index = len(slot_sizes)
                body = spec.worldbody.add_body(name=f"voxbot-body-{index}", mocap=True, pos=[0, 0, -100])
                body.add_geom(
                name=f"voxbot-{index}",
                type=mujoco.mjtGeom.mjGEOM_BOX,
                size=[limit, limit, limit],
                contype=2,
                conaffinity=1,
                )
                slot_sizes.append(limit)
        self.model = spec.compile()
        self.model.opt.enableflags |= int(mujoco.mjtEnableBit.mjENBL_MULTICCD)
        self.data = mujoco.MjData(self.model)
        self.geom_ids = np.array([self.model.geom(f"voxbot-{index}").id for index in range(ACTIVE_BOXES)])
        self.mocap_ids = self.model.body_mocapid[self.model.geom_bodyid[self.geom_ids]]
        self.slot_sizes = np.array(slot_sizes)
        self.slot_groups = [np.where(self.slot_sizes == limit)[0].tolist() for limit, _ in BOX_SLOTS]
        self.policy = ort.InferenceSession(str(POLICY), providers=["CPUExecutionProvider"])
        self.client = None
        self.origin = np.zeros(3)
        self.floor = 0.0
        self.colliders = {}
        self.collision_dirty = False
        self.collision_at = 0.0
        self.boxes = []
        self.blocked = set()
        self.active_count = 0
        self.report_count = 0
        self.active_boxes = []
        self.debug = False
        self.debug_dirty = False
        self.collision_pos = np.array([float("inf"), float("inf"), float("inf")])
        self.last = np.zeros(29, dtype=np.float32)
        self.target_q = DEFAULT.copy()
        self.phase = 0.0
        self.path = []
        self.target = np.array([4.0, 0.0])
        self.auto = False
        self.manual = np.zeros(3, dtype=np.float32)
        self.command_at = 0.0
        self.fly = False
        self.lift = 0.0
        self.jump = False
        self.jump_until = 0.0
        self.best = float("inf")
        self.progress_at = 0.0
        self.fallen_at = None
        self.next_stumble = 15.0
        self.safe = np.zeros(7 + 29)
        self.safe[2] = 0.8
        self.safe[3] = 1
        self.safe[7:] = DEFAULT
        self.reset(self.safe)

    def reset(self, pose=None):
        mujoco.mj_resetData(self.model, self.data)
        self.data.qpos[:] = self.safe if pose is None else pose
        self.data.qpos[2] = max(self.data.qpos[2], 0.8)
        self.data.qpos[3:7] = [1, 0, 0, 0]
        self.data.qpos[7:] = DEFAULT
        self.data.qvel[:] = 0
        self.last[:] = 0
        self.target_q[:] = DEFAULT
        self.fallen_at = None
        self.jump_until = 0.0
        self.placeBoxes()
        mujoco.mj_forward(self.model, self.data)

    def message(self, message):
        kind = message.get("type")
        if kind == "hello":
            self.origin = np.array(message["origin"], dtype=np.float64)
            self.floor = float(message["floor"])
            self.colliders.clear()
            self.collision_dirty = True
            self.collision_at = time.monotonic()
            self.safe[:2] = 0
            self.reset()
            self.next_stumble = self.data.time + 8
            self.auto = False
        elif kind == "collider":
            self.colliders[message["id"]] = message["boxes"]
            self.collision_dirty = True
            self.collision_at = time.monotonic()
        elif kind == "drop":
            self.colliders.pop(message["id"], None)
            self.collision_dirty = True
            self.collision_at = time.monotonic()
        elif kind == "command":
            self.manual[:] = np.array(message.get("move", [0, 0, 0]), dtype=np.float32)[:3]
            self.command_at = time.monotonic()
            self.fly = bool(message.get("fly"))
            self.lift = float(message.get("lift", 0))
            self.jump = self.jump or bool(message.get("jump"))
            self.auto = False
            self.path = []
        elif kind == "target":
            self.set_target(np.array(message["target"], dtype=np.float64))
        elif kind == "debug":
            self.debug = bool(message.get("enabled"))
            self.debug_dirty = self.debug
        elif kind == "respawn":
            self.auto = False
            self.path = []
            self.reset()
            print("robot respawned")

    def collide(self):
        boxes = []
        for group in self.colliders.values():
            for box in group:
                center = np.array(box[:3], dtype=np.float64) - np.array([self.origin[0], self.floor, self.origin[2]])
                center = BASIS @ center
                half = np.array([box[3], box[5], box[4]], dtype=np.float64)
                rotation = BASIS @ quat_matrix(box[6:10]) @ BASIS.T
                boxes.extend(split_box(center, half, matrix_quat(rotation)))
        self.boxes = boxes[:MAX_BOXES]
        self.nearBoxes()
        count = len(self.boxes)
        self.navmesh()
        if count - self.report_count >= 500 or (count == MAX_BOXES and self.report_count != count):
            self.report_count = count
            print(f"collision boxes: {count} loaded, {self.active_count} near")

    def nearBoxes(self):
        for slot, _, _, _ in self.active_boxes:
            self.data.mocap_pos[self.mocap_ids[slot]] = [0, 0, -100]
        available = [group.copy() for group in self.slot_groups]
        self.active_boxes = []
        placed = []
        position = self.data.qpos[:3]
        robot_half = np.array([0.45, 0.45, 0.9])
        physical = [box for box in self.boxes if box[0][2] + box[1][2] > 0.05]
        candidates = []
        for box in physical:
            distance = np.sum(np.maximum(np.abs(box[0] - position) - box[1] - robot_half, 0) ** 2)
            group = next(index for index, (limit, _) in enumerate(BOX_SLOTS) if max(box[1]) <= limit)
            candidates.append((distance, group, box))
        candidates.sort(key=lambda candidate: candidate[0])

        def place_box(candidate, group):
            _, _, (center, half, quat) = candidate
            slot = available[group].pop()
            geom_id = self.geom_ids[slot]
            self.model.geom_size[geom_id] = np.maximum(half, 0.005)
            self.active_boxes.append((slot, center, half, quat))
            placed.append((center, half, quat))

        waiting = []
        for group in reversed(range(len(BOX_SLOTS))):
            own = [candidate for candidate in candidates if candidate[1] == group]
            for candidate in own[:len(available[group])]:
                place_box(candidate, group)
            waiting.extend(own[len(self.slot_groups[group]):])
        for candidate in sorted(waiting, key=lambda item: item[0]):
            group = next((index for index in range(candidate[1], len(BOX_SLOTS)) if available[index]), None)
            if group is None:
                continue
            place_box(candidate, group)
        self.placeBoxes()
        count = len(placed)
        self.active_count = count
        self.collision_pos = position.copy()
        self.debug_dirty = self.debug

    def placeBoxes(self):
        for slot, center, _, quat in self.active_boxes:
            mocap_id = self.mocap_ids[slot]
            self.data.mocap_pos[mocap_id] = center
            self.data.mocap_quat[mocap_id] = quat

    def debugBoxes(self):
        boxes = []
        offset = np.array([self.origin[0], self.floor, self.origin[2]])
        for _, center, half, quat in self.active_boxes:
            world = BASIS.T @ center + offset
            rotation = quat_matrix([quat[1], quat[2], quat[3], quat[0]])
            converted = matrix_quat(BASIS.T @ rotation @ BASIS)
            boxes.append([
                *world.tolist(), half[0], half[2], half[1],
                float(converted[1]), float(converted[2]), float(converted[3]), float(converted[0]),
            ])
        return boxes

    def navmesh(self):
        blocked = set()
        for center, half, _ in self.boxes:
            bottom = center[2] - half[2]
            top = center[2] + half[2]
            if top <= 0.65 or bottom >= 1.3:
                continue
            x0 = math.floor((center[0] - half[0] - 0.22) / CELL)
            x1 = math.ceil((center[0] + half[0] + 0.22) / CELL)
            y0 = math.floor((center[1] - half[1] - 0.22) / CELL)
            y1 = math.ceil((center[1] + half[1] + 0.22) / CELL)
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    blocked.add((x, y))
        self.blocked = blocked
        if self.auto and any(tuple(np.floor(point / CELL).astype(int)) in blocked for point in self.path):
            self.set_target(self.target)

    def astar(self, start, goal):
        frontier = [(0, start)]
        came = {start: None}
        cost = {start: 0}
        while frontier and len(came) < 6000:
            _, current = heapq.heappop(frontier)
            if current == goal:
                break
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                next_cell = (current[0] + dx, current[1] + dy)
                if next_cell in self.blocked or abs(next_cell[0] - start[0]) > 24 or abs(next_cell[1] - start[1]) > 24:
                    continue
                if dx and dy and ((current[0] + dx, current[1]) in self.blocked or (current[0], current[1] + dy) in self.blocked):
                    continue
                next_cost = cost[current] + math.hypot(dx, dy)
                if next_cell in cost and next_cost >= cost[next_cell]:
                    continue
                cost[next_cell] = next_cost
                came[next_cell] = current
                priority = next_cost + math.hypot(goal[0] - next_cell[0], goal[1] - next_cell[1])
                heapq.heappush(frontier, (priority, next_cell))
        if goal not in came:
            return []
        path = []
        current = goal
        while current != start:
            path.append(np.array([(current[0] + 0.5) * CELL, (current[1] + 0.5) * CELL]))
            current = came[current]
        path.reverse()
        return path

    def set_target(self, target):
        position = self.data.qpos[:2]
        delta = target - position
        distance = np.linalg.norm(delta)
        segment = target if distance <= 10 else position + delta / distance * 10
        start = tuple(np.floor(position / CELL).astype(int))
        goal = tuple(np.floor(segment / CELL).astype(int))
        self.path = self.astar(start, goal)
        if not self.path and distance > 0.65:
            self.path = [segment]
        self.target = target
        self.auto = bool(self.path)
        self.best = float("inf")
        self.progress_at = self.data.time
        print(f"target: {self.target.round(2)} waypoints: {len(self.path)}")

    def command(self):
        position = self.data.qpos[:2]
        quat = self.data.qpos[3:7]
        yaw = math.atan2(2 * (quat[0] * quat[3] + quat[1] * quat[2]), 1 - 2 * (quat[2] ** 2 + quat[3] ** 2))
        if not self.auto:
            if time.monotonic() - self.command_at > 0.25:
                self.manual[:] = 0
            return self.manual.copy(), yaw
        while self.path and np.linalg.norm(self.path[0] - position) < 0.65:
            self.path.pop(0)
        if not self.path:
            if np.linalg.norm(self.target - position) >= 0.65:
                self.set_target(self.target)
                return np.zeros(3, dtype=np.float32), yaw
            self.auto = False
            return np.zeros(3, dtype=np.float32), yaw
        waypoint = self.path[0]
        delta = waypoint - position
        desired = math.atan2(delta[1], delta[0])
        error = (desired - yaw + math.pi) % (2 * math.pi) - math.pi
        distance = np.linalg.norm(self.target - position)
        if distance < self.best - 0.15:
            self.best = distance
            self.progress_at = self.data.time
        if self.data.time - self.progress_at > 4:
            self.set_target(self.target)
            return np.zeros(3, dtype=np.float32), yaw
        forward = 0.65 if abs(error) < 0.7 else 0.12
        return np.array([forward, 0, np.clip(error * 1.5, -1, 1)], dtype=np.float32), yaw

    def step(self):
        if np.linalg.norm(self.data.qpos[:3] - self.collision_pos) > 0.5:
            self.nearBoxes()
        if self.data.time > self.next_stumble and self.fallen_at is None:
            self.data.qvel[1] += random.choice((-4.0, 4.0))
            self.data.qvel[3] += random.choice((-5.0, 5.0))
            self.next_stumble = self.data.time + random.uniform(22, 32)
            print("robot stumbled")
        self.model.opt.gravity[2] = 0 if self.fly else -9.81
        command, yaw = self.command()
        quat = self.data.qpos[3:7].copy()
        projected = rotate(np.array([quat[0], -quat[1], -quat[2], -quat[3]]), np.array([0, 0, -1.0]))
        if self.jump and not self.fly and self.fallen_at is None and projected[2] < -0.8 and self.data.qpos[2] < 1.0:
            self.data.qvel[2] = max(self.data.qvel[2], 1.8)
            self.jump_until = self.data.time + 0.45
        self.jump = False
        self.phase = (self.phase + 0.02 / 0.6) % 1.0
        gait = np.array([math.sin(self.phase * math.tau), math.cos(self.phase * math.tau)], dtype=np.float32)
        if self.fallen_at is None:
            obs = np.concatenate([
                self.data.sensor("imu_gyro").data.copy(), projected, command, gait,
                self.data.qpos[7:] - DEFAULT, self.data.qvel[6:], self.last,
            ]).astype(np.float32)
            self.last = self.policy.run(None, {"obs": obs[None]})[0][0]
            self.target_q = DEFAULT + SCALE * self.last
        for _ in range(round(0.02 / self.model.opt.timestep)):
            if self.fly:
                self.data.qvel[2] = self.lift * 1.8
            elif self.data.time < self.jump_until:
                self.data.qvel[3:5] *= 0.5
            if self.fallen_at is None:
                self.data.ctrl[:] = KP * (self.target_q - self.data.qpos[7:]) - KD * self.data.qvel[6:]
            else:
                self.data.ctrl[:] = np.clip(-0.2 * self.data.qvel[6:], -5, 5)
            mujoco.mj_step(self.model, self.data)

        fallen = projected[2] > -0.4 or self.data.qpos[2] < 0.35
        if not fallen and np.linalg.norm(self.data.qvel[:2]) < 2:
            self.safe[:] = self.data.qpos
        if fallen and self.fallen_at is None:
            self.fallen_at = self.data.time
            print("robot fell")
        if self.fallen_at is not None and self.data.time - self.fallen_at > 1.5:
            print("robot respawned")
            self.reset()
            if self.auto:
                self.set_target(self.target)
            fallen = False

        pose = {
            "type": "pose",
            "root": self.data.qpos[:3].tolist(),
            "bodies": self.body_poses(),
            "yaw": float(yaw),
            "fallen": bool(fallen),
            "target": self.target.tolist(),
            "auto": self.auto,
        }
        if self.debug_dirty:
            pose["colliders"] = self.debugBoxes()
            self.debug_dirty = False
        return pose

    def body_poses(self):
        poses = []
        for body in range(1, self.robot_count + 1):
            quat = self.data.xquat[body]
            rotation = quat_matrix([quat[1], quat[2], quat[3], quat[0]])
            converted = matrix_quat(BASIS.T @ rotation @ BASIS)
            poses.append([
                *self.data.xpos[body].tolist(),
                float(converted[1]), float(converted[2]), float(converted[3]), float(converted[0]),
            ])
        return poses

robot = Robot()


async def connect(socket):
    robot.client = socket
    print("game connected")
    try:
        async for raw in socket:
            robot.message(json.loads(raw))
    finally:
        if robot.client is socket:
            robot.client = None
        print("game disconnected")


async def simulate():
    while True:
        started = asyncio.get_running_loop().time()
        if robot.collision_dirty and time.monotonic() - robot.collision_at > 0.5:
            robot.collision_dirty = False
            robot.collide()
        if robot.client:
            try:
                await robot.client.send(json.dumps(robot.step()))
            except websockets.ConnectionClosed:
                robot.client = None
        elapsed = asyncio.get_running_loop().time() - started
        await asyncio.sleep(max(0, 0.02 - elapsed))


async def main():
    async with websockets.serve(connect, "127.0.0.1", 8765, max_size=64 * 1024 * 1024):
        print("robot server: ws://127.0.0.1:8765")
        await simulate()


if __name__ == "__main__":
    asyncio.run(main())
