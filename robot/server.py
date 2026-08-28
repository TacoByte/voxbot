import asyncio
import base64
import heapq
import json
import math
import time
from pathlib import Path

import joblib
import mujoco
import numpy as np
import onnxruntime as ort
import websockets


ROOT = Path(__file__).resolve().parent
UNITREE = ROOT / "vendor" / "unitree_rl_mjlab"
MICRODUCK = ROOT / "vendor" / "microduck_rl"
RUNTIME = ROOT / "vendor" / "microduck"
TODDLER = ROOT / "vendor" / "toddlerbot"
HANDOFF = ROOT / "vendor" / "handoff"
HIKING = ROOT / "vendor" / "hiking"
HIKING_MODELS = HIKING / "hiking-in-the-wild_Data&Model" / "data&model" / "checkpoints"
PHP = ROOT / "vendor" / "php-parkour" / "mujoco_wasm"
VANILLA_MODEL = UNITREE / "src" / "assets" / "robots" / "unitree_g1" / "xmls" / "scene_g1.xml"
VANILLA_POLICY = UNITREE / "deploy" / "robots" / "g1" / "config" / "policy" / "velocity" / "v0" / "exported" / "policy.onnx"
HIKING_MODEL = HIKING / "sim2sim" / "assets" / "scene" / "g1.xml"
HIKING_POLICY = HIKING_MODELS / "parkour_onboard_preview_stair" / "exported" / "actor.onnx"
G1_DEPTH = HIKING_MODELS / "parkour_onboard_preview_stair" / "exported" / "0-depth_encoder.onnx"
G1_STAND = HIKING_MODELS / "stand_onboard" / "exported" / "actor.onnx"
G1_STAND_DEPTH = HIKING_MODELS / "stand_onboard" / "exported" / "0-depth_encoder.onnx"
PHP_MODEL = PHP / "assets" / "scenes" / "g1_with_terrain.xml"
PHP_POLICY = PHP / "public" / "2026-01-17_09-51-30_student-new-loco-old-skill_student.onnx"
PHP_DEPTH = PHP / "public" / "2026-01-17_09-51-30_student-new-loco-old-skill_depth_backbone.onnx"
G1_RECOVERY = HANDOFF / "deploy" / "ckpt" / "policy.onnx"
DUCK_MODEL = MICRODUCK / "src" / "mjlab_microduck" / "robot" / "microduck" / "scene.xml"
DUCK_POLICY = RUNTIME / "policies" / "alpha_walking.onnx"
DUCK_RECOVERY = RUNTIME / "policies" / "alpha_stand.onnx"
DUCK_ROULADE = RUNTIME / "policies" / "roulade.onnx"
TODDLER_MODEL = TODDLER / "toddlerbot" / "descriptions" / "toddlerbot_2xc" / "scene.xml"
TODDLER_POLICY = ROOT / "artifacts" / "toddler" / "toddlerbot_2xc_walk_rsl_20251226_114612" / "model_best.onnx"
TODDLER_MOTION = TODDLER / "motion"
MAX_BOXES = 20000
ACTIVE_BOXES = 1500
BOX_COUNTS = ((0.25, 900), (0.5, 300), (1, 150), (2, 75), (4, 45), (8, 22), (16, 8))

DUCK_DEFAULT = np.array([
    0, -0.0873, -0.4579, -0.0049, 0.453,
    0.3491, 0.3491, 0, 0,
    0, 0.0873, 0.4579, 0.0049, -0.453,
], dtype=np.float32)
VANILLA_DEFAULT = np.array([
    -0.1, 0, 0, 0.3, -0.2, 0,
    -0.1, 0, 0, 0.3, -0.2, 0,
    0, 0, 0,
    0.35, 0.18, 0, 0.87, 0, 0, 0,
    0.35, -0.18, 0, 0.87, 0, 0, 0,
], dtype=np.float32)
HANDOFF_DEFAULT = np.array([
    -0.312, 0, 0, 0.669, -0.363, 0,
    -0.312, 0, 0, 0.669, -0.363, 0,
    0, 0, 0,
    0.2, 0.2, 0, 0.6, 0, 0, 0,
    0.2, -0.2, 0, 0.6, 0, 0, 0,
], dtype=np.float32)
G1_SCALE = np.array([
    0.548, 0.351, 0.548, 0.351, 0.439, 0.439,
    0.548, 0.351, 0.548, 0.351, 0.439, 0.439,
    0.548, 0.439, 0.439,
    0.439, 0.439, 0.439, 0.439, 0.439, 0.075, 0.075,
    0.439, 0.439, 0.439, 0.439, 0.439, 0.075, 0.075,
], dtype=np.float32)
G1_KP = np.array([
    40.179, 99.098, 40.179, 99.098, 28.501, 28.501,
    40.179, 99.098, 40.179, 99.098, 28.501, 28.501,
    40.179, 28.501, 28.501,
    14.251, 14.251, 14.251, 14.251, 14.251, 16.778, 16.778,
    14.251, 14.251, 14.251, 14.251, 14.251, 16.778, 16.778,
], dtype=np.float32)
G1_KD = np.array([
    2.558, 6.309, 2.558, 6.309, 1.814, 1.814,
    2.558, 6.309, 2.558, 6.309, 1.814, 1.814,
    2.558, 1.814, 1.814,
    0.907, 0.907, 0.907, 0.907, 0.907, 1.068, 1.068,
    0.907, 0.907, 0.907, 0.907, 0.907, 1.068, 1.068,
], dtype=np.float32)
G1_JOINTS = [
    "left_hip_pitch_joint", "left_hip_roll_joint", "left_hip_yaw_joint", "left_knee_joint", "left_ankle_pitch_joint", "left_ankle_roll_joint",
    "right_hip_pitch_joint", "right_hip_roll_joint", "right_hip_yaw_joint", "right_knee_joint", "right_ankle_pitch_joint", "right_ankle_roll_joint",
    "waist_yaw_joint", "waist_roll_joint", "waist_pitch_joint",
    "left_shoulder_pitch_joint", "left_shoulder_roll_joint", "left_shoulder_yaw_joint", "left_elbow_joint", "left_wrist_roll_joint", "left_wrist_pitch_joint", "left_wrist_yaw_joint",
    "right_shoulder_pitch_joint", "right_shoulder_roll_joint", "right_shoulder_yaw_joint", "right_elbow_joint", "right_wrist_roll_joint", "right_wrist_pitch_joint", "right_wrist_yaw_joint",
]
HIKING_JOINTS = [
    "left_shoulder_pitch_joint", "right_shoulder_pitch_joint", "waist_pitch_joint", "left_shoulder_roll_joint", "right_shoulder_roll_joint", "waist_roll_joint",
    "left_shoulder_yaw_joint", "right_shoulder_yaw_joint", "waist_yaw_joint", "left_elbow_joint", "right_elbow_joint", "left_hip_pitch_joint",
    "right_hip_pitch_joint", "left_wrist_roll_joint", "right_wrist_roll_joint", "left_hip_roll_joint", "right_hip_roll_joint",
    "left_wrist_pitch_joint", "right_wrist_pitch_joint", "left_hip_yaw_joint", "right_hip_yaw_joint", "left_wrist_yaw_joint", "right_wrist_yaw_joint",
    "left_knee_joint", "right_knee_joint", "left_ankle_pitch_joint", "right_ankle_pitch_joint", "left_ankle_roll_joint", "right_ankle_roll_joint",
]
HIKING_TO_G1 = np.array([G1_JOINTS.index(name) for name in HIKING_JOINTS])
HIKING_SIGN = np.array([1, 1, -1, 1, 1, -1, 1, 1, -1] + [1] * 20, dtype=np.float32)
HIKING_DEFAULT = np.array([
    0.2, 0.2, 0, 0.2, -0.2, 0, 0, 0, 0, 0.6, 0.6, -0.312, -0.312, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0.669, 0.669, -0.363, -0.363, 0, 0,
], dtype=np.float32)
HIKING_SCALE = np.array([
    0.439, 0.439, 0.439, 0.439, 0.439, 0.439, 0.439, 0.439, 0.548, 0.439, 0.439, 0.548, 0.548, 0.439, 0.439,
    0.351, 0.351, 0.0745, 0.0745, 0.548, 0.548, 0.0745, 0.0745, 0.351, 0.351, 0.439, 0.439, 0.439, 0.439,
], dtype=np.float32)
PHP_JOINTS = [
    "left_hip_pitch_joint", "right_hip_pitch_joint", "waist_yaw_joint", "left_hip_roll_joint", "right_hip_roll_joint", "waist_roll_joint",
    "left_hip_yaw_joint", "right_hip_yaw_joint", "waist_pitch_joint", "left_knee_joint", "right_knee_joint", "left_shoulder_pitch_joint",
    "right_shoulder_pitch_joint", "left_ankle_pitch_joint", "right_ankle_pitch_joint", "left_shoulder_roll_joint", "right_shoulder_roll_joint",
    "left_ankle_roll_joint", "right_ankle_roll_joint", "left_shoulder_yaw_joint", "right_shoulder_yaw_joint", "left_elbow_joint", "right_elbow_joint",
    "left_wrist_roll_joint", "right_wrist_roll_joint", "left_wrist_pitch_joint", "right_wrist_pitch_joint", "left_wrist_yaw_joint", "right_wrist_yaw_joint",
]
PHP_TO_G1 = np.array([G1_JOINTS.index(name) for name in PHP_JOINTS])
PHP_DEFAULT = np.array([
    -0.313, -0.310, 0.007, -0.003, -0.007, 0.006, -0.004, 0.002, 0.004, 0.661, 0.660, 0.197, 0.204, -0.354, -0.358,
    0.208, -0.196, -0.001, 0.004, -0.007, -0.002, 0.602, 0.608, 0.007, 0.007, 0.007, 0.003, -0.007, 0,
], dtype=np.float32)
PHP_SCALE = np.array([
    0.548, 0.548, 0.548, 0.351, 0.351, 0.439, 0.548, 0.548, 0.439, 0.351, 0.351, 0.439, 0.439, 0.439, 0.439,
    0.439, 0.439, 0.439, 0.439, 0.439, 0.439, 0.439, 0.439, 0.439, 0.439, 0.25, 0.25, 0.25, 0.25,
], dtype=np.float32)
HANDOFF_VEL_SCALE = np.array([0 if index in (4, 5, 10, 11) else 0.05 for index in range(29)], dtype=np.float32)
HANDOFF_HANDS = np.array([0.04, 0.23044664, -0.07842005, 0.04, -0.23043664, -0.07842005], dtype=np.float32)
TODDLER_DEFAULT = np.array([
    0, 0, 0, 0, -0.091312, 0, 0, -0.380812, 0, -0.2895,
    0.091312, 0, 0, 0.380812, 0, 0.2895,
    0.174533, 0.087266, 1.570796, -0.523599, -1.570796, -1.22173, 0,
    -0.174533, 0.087266, -1.570796, -0.523599, 1.570796, 1.22173, 0,
], dtype=np.float32)
TODDLER_TYPES = (
    ["XC330"] * 4
    + ["2XC430", "2XC430", "XC330", "XM210", "XC430", "XM210"] * 2
    + ["XC430", "2XL", "2XL", "2XL", "2XL", "2XL", "2XL"] * 2
)
TODDLER_SPECS = {
    "XC330": (10, 0.68, 6.52, 0.49, 1.0, 1.54, 0.341),
    "XC430": (10, 1.47, 7.0, 0.19, 1.2, 2.0, 0.173),
    "XM210": (14, 1.94, 7.6, 0.4, 0.8, 2.2, 0.183),
    "2XL": (4, 0.93, 5.97, 0.08, 2.0, 1.4, 0.162),
    "2XC430": (14, 1.09, 6.78, 0.23, 2.0, 2.2, 0.185),
}
TODDLER_CONTROL = [np.array([TODDLER_SPECS[name][index] for name in TODDLER_TYPES], dtype=np.float32) for index in range(7)]
BASIS = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)
WORLD_BASIS = np.array([[-1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=np.float64)


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


def split_box(center, half, quat, limit):
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
    def __init__(self, kind, mode=None):
        self.kind = kind
        self.duck = kind == "duck"
        self.toddler = kind == "toddler"
        self.g1_mode = mode if kind == "g1" else None
        self.game_scale = 8.0 if self.duck else 2.0 if self.toddler else 1.0
        self.sim_scale = 1 / self.game_scale
        self.root_height = 0.117 if self.duck else 0.310053 if self.toddler else 0.8
        self.cell = 0.5 * self.sim_scale
        self.box_slots = [(size * self.sim_scale, count) for size, count in BOX_COUNTS]
        self.default = DUCK_DEFAULT if self.duck else TODDLER_DEFAULT if self.toddler else VANILLA_DEFAULT if self.g1_mode == "vanilla" else HANDOFF_DEFAULT
        if self.duck:
            model_path, policy_path = DUCK_MODEL, DUCK_POLICY
        elif self.toddler:
            model_path, policy_path = TODDLER_MODEL, TODDLER_POLICY
        elif self.g1_mode == "vanilla":
            model_path, policy_path = VANILLA_MODEL, VANILLA_POLICY
        elif self.g1_mode == "parkour":
            model_path, policy_path = PHP_MODEL, PHP_POLICY
        else:
            model_path, policy_path = HIKING_MODEL, HIKING_POLICY
        required = [model_path, policy_path]
        if self.duck:
            required.extend([DUCK_RECOVERY, DUCK_ROULADE])
        elif not self.toddler:
            required.append(G1_RECOVERY)
            if self.g1_mode == "hiking":
                required.extend([G1_DEPTH, G1_STAND, G1_STAND_DEPTH])
            elif self.g1_mode == "parkour":
                required.append(PHP_DEPTH)
        if not all(path.exists() for path in required):
            raise SystemExit("Run robot/setup.sh first")
        spec = mujoco.MjSpec.from_file(str(model_path))
        if self.g1_mode == "vanilla":
            spec.delete(spec.geom("floor"))
        elif self.g1_mode == "parkour":
            spec.delete(spec.body("terrain_boxes"))
            spec.delete(spec.body("finish_marker"))
            spec.delete(spec.geom("floor"))
            spec.body("torso_link").add_camera(
                name="depth_camera", pos=[0.01, 0.01, 0.44], quat=[0.60290764, 0.37585401, -0.362958, -0.60290765], fovy=58.4,
            )
        self.robot_count = len(spec.bodies) - 1
        spec.memory = 128 * 1024 * 1024
        if not self.duck and not self.toddler:
            spec.worldbody.add_geom(name="floor", type=mujoco.mjtGeom.mjGEOM_PLANE, size=[0, 0, 0.05])
        island_body = spec.worldbody.add_body(name="voxbot-island-body", mocap=True, pos=[0, 0, -100])
        island_body.add_geom(name="voxbot-island", type=mujoco.mjtGeom.mjGEOM_BOX, size=[256, 256, 32], contype=2, conaffinity=1)
        slot_sizes = []
        for limit, count in self.box_slots:
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
        if not self.duck and not self.toddler:
            self.model.stat.extent = 10
            self.model.vis.map.znear = 0.03
            self.model.vis.map.zfar = 0.3
        self.body_ids = list(range(1, self.robot_count + 1))
        if not self.duck and not self.toddler:
            self.body_ids = [body for body in self.body_ids if self.model.body(body).name != "d435_link"]
        if self.duck:
            self.model.opt.timestep = 0.005
        elif self.toddler:
            self.model.opt.timestep = 0.001
            for geom in range(self.model.ngeom):
                name = self.model.geom(geom).name
                if self.model.geom_bodyid[geom] and "collision" in name:
                    self.model.geom_contype[geom] = 1
                    self.model.geom_conaffinity[geom] = 2
                    body = self.model.geom_bodyid[geom]
                    self.model.body_contype[body] = 1
                    self.model.body_conaffinity[body] = 2
        self.model.opt.enableflags |= int(mujoco.mjtEnableBit.mjENBL_MULTICCD)
        self.floor_geom = self.model.geom("floor").id
        self.floor_contact = (self.model.geom_contype[self.floor_geom], self.model.geom_conaffinity[self.floor_geom])
        self.floor_pairs = np.where((self.model.pair_geom1 == self.floor_geom) | (self.model.pair_geom2 == self.floor_geom))[0]
        self.floor_margins = self.model.pair_margin[self.floor_pairs].copy()
        self.island_geom = self.model.geom("voxbot-island").id
        self.island_mocap = self.model.body_mocapid[self.model.geom_bodyid[self.island_geom]]
        self.data = mujoco.MjData(self.model)
        self.geom_ids = np.array([self.model.geom(f"voxbot-{index}").id for index in range(ACTIVE_BOXES)])
        self.mocap_ids = self.model.body_mocapid[self.model.geom_bodyid[self.geom_ids]]
        self.slot_sizes = np.array(slot_sizes)
        self.slot_groups = [np.where(self.slot_sizes == limit)[0].tolist() for limit, _ in self.box_slots]
        self.policy = ort.InferenceSession(str(policy_path), providers=["CPUExecutionProvider"])
        self.policy_input = self.policy.get_inputs()[0].name
        self.recovery_policy = ort.InferenceSession(str(DUCK_RECOVERY), providers=["CPUExecutionProvider"]) if self.duck else None
        self.roulade_policy = ort.InferenceSession(str(DUCK_ROULADE), providers=["CPUExecutionProvider"]) if self.duck else None
        self.depth_policy = None
        self.stand_policy = None
        self.stand_depth_policy = None
        self.handoff_policy = None
        self.renderer = None
        if not self.duck and not self.toddler:
            if self.g1_mode == "hiking":
                self.depth_policy = ort.InferenceSession(str(G1_DEPTH), providers=["CPUExecutionProvider"])
                self.stand_policy = ort.InferenceSession(str(G1_STAND), providers=["CPUExecutionProvider"])
                self.stand_depth_policy = ort.InferenceSession(str(G1_STAND_DEPTH), providers=["CPUExecutionProvider"])
            elif self.g1_mode == "parkour":
                self.depth_policy = ort.InferenceSession(str(PHP_DEPTH), providers=["CPUExecutionProvider"])
            self.handoff_policy = ort.InferenceSession(str(G1_RECOVERY), providers=["CPUExecutionProvider"])
        if self.duck or self.toddler:
            self.joint_qpos = np.array([self.model.jnt_qposadr[self.model.actuator_trnid[index, 0]] for index in range(self.model.nu)])
            self.joint_qvel = np.array([self.model.jnt_dofadr[self.model.actuator_trnid[index, 0]] for index in range(self.model.nu)])
        if self.duck:
            self.imu = self.model.sensor("imu_ang_vel").id
            self.trunk = self.model.body("trunk_base").id
        elif self.toddler:
            self.trunk = self.model.body("torso").id
        else:
            self.trunk = self.model.body("torso_link").id
            self.pelvis = self.model.body("pelvis").id
        self.client = None
        self.origin = np.zeros(3)
        self.floor = 0.0
        self.ground = 0.0
        self.height_offset = 0.0
        self.colliders = {}
        self.collision_dirty = False
        self.collision_at = 0.0
        self.boxes = []
        self.island_box = None
        self.blocked = set()
        self.active_count = 0
        self.report_count = 0
        self.active_boxes = []
        self.debug = False
        self.debug_dirty = False
        self.collision_pos = np.array([float("inf"), float("inf"), float("inf")])
        self.last = np.zeros(14 if self.duck else 12 if self.toddler else 29, dtype=np.float32)
        self.target_q = self.default.copy()
        self.history = np.zeros(1260, dtype=np.float32) if self.toddler else None
        self.action_buffer = np.zeros(24, dtype=np.float32) if self.toddler else None
        self.depth_frame = None
        self.depth_at = -1
        self.depth_history = None
        self.hike_history = None
        self.stand_history = None
        self.hike_ready = False
        self.stand_ready = False
        self.hike_last = None
        self.stand_last = None
        self.php_last = None
        self.php_depth = []
        self.handoff_history = None
        self.handoff_ready = False
        self.handoff_last = None
        if not self.duck and not self.toddler:
            self.hike_history = np.zeros((8, 96), dtype=np.float32)
            self.stand_history = np.zeros((8, 96), dtype=np.float32)
            self.hike_last = np.zeros(29, dtype=np.float32)
            self.stand_last = np.zeros(29, dtype=np.float32)
            self.php_last = np.zeros(29, dtype=np.float32)
            self.handoff_history = np.zeros((11, 106), dtype=np.float32)
            self.handoff_last = np.zeros(29, dtype=np.float32)
        self.target_yaw = 0.0
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
        self.fall_steps = 0
        self.recovery = None
        self.recovery_motion = 0.0
        self.recovery_from = None
        self.recovery_attempts = 0
        self.recovery_steps = 0
        self.upright_steps = 0
        self.roulade_steps = 0
        self.safe = self.model.keyframe("home").qpos.copy() if self.toddler else np.zeros(self.model.nq)
        self.toddler_motions = {}
        if self.toddler:
            for name in ["prone", "prone_left", "prone_right", "prone_both", "roll", "roll_left", "roll_right"]:
                self.toddler_motions[name] = joblib.load(TODDLER_MOTION / f"get_up_{name}_2xc.lz4")["action"].astype(np.float32)
        self.safe[2] = self.root_height
        self.safe[3] = 1
        if self.duck:
            self.safe[self.joint_qpos] = self.default
        elif not self.toddler:
            self.safe[7:] = self.default
        self.reset(self.safe)

    def reset(self, pose=None):
        mujoco.mj_resetData(self.model, self.data)
        self.data.qpos[:] = self.safe if pose is None else pose
        self.data.qpos[2] = self.ground + self.root_height if self.duck else max(self.data.qpos[2], self.ground + self.root_height)
        self.data.qpos[3:7] = [1, 0, 0, 0]
        if self.duck:
            self.data.qpos[self.joint_qpos] = self.default
            self.data.ctrl[:] = self.default
        elif not self.toddler:
            self.data.qpos[7:] = self.default
        self.data.qvel[:] = 0
        self.last[:] = 0
        self.phase = 0
        self.target_q[:] = self.default
        if self.toddler:
            self.history[:] = 0
            self.action_buffer[:] = 0
            self.target_yaw = 0.0
        elif not self.duck:
            self.depth_frame = None
            self.depth_at = -1
            self.depth_history = None
            self.hike_history[:] = 0
            self.stand_history[:] = 0
            self.hike_ready = False
            self.stand_ready = False
            self.hike_last[:] = 0
            self.stand_last[:] = 0
            self.php_last[:] = 0
            self.php_depth.clear()
            self.handoff_history[:] = 0
            self.handoff_ready = False
            self.handoff_last[:] = 0
        self.jump_until = 0.0
        self.fallen_at = None
        self.fall_steps = 0
        self.recovery = None
        self.recovery_motion = 0.0
        self.recovery_from = None
        self.recovery_attempts = 0
        self.recovery_steps = 0
        self.upright_steps = 0
        self.roulade_steps = 0

    def takeState(self, old):
        pose = old.data.qpos.copy()
        velocity = old.data.qvel.copy()
        self.origin[:] = old.origin
        self.floor = old.floor
        self.ground = old.ground
        self.colliders = old.colliders.copy()
        self.reset(pose)
        self.data.qpos[7:] = pose[7:]
        self.data.qpos[3:7] = pose[3:7]
        self.data.qvel[:] = velocity
        self.safe[:] = old.safe
        self.target[:] = old.target
        self.path = [point.copy() for point in old.path]
        self.auto = old.auto
        self.manual[:] = old.manual
        self.command_at = old.command_at
        self.fly = old.fly
        self.lift = old.lift
        self.collide()
        mujoco.mj_forward(self.model, self.data)
        self.recovery = "handoff" if old.recovery == "handoff" else "resume"
        self.recovery_from = old.target_q.copy()
        self.recovery_steps = 0
        self.recovery_motion = 0.0
        self.fallen_at = old.fallen_at
        self.placeBoxes()
        if self.island_box:
            center, _, quat = self.island_box
            self.data.mocap_pos[self.island_mocap] = center
            self.data.mocap_quat[self.island_mocap] = quat
        mujoco.mj_forward(self.model, self.data)

    def message(self, message):
        kind = message.get("type")
        if kind == "hello":
            self.model.geom_contype[self.floor_geom], self.model.geom_conaffinity[self.floor_geom] = self.floor_contact
            self.model.pair_margin[self.floor_pairs] = self.floor_margins
            self.origin = np.array(message["origin"], dtype=np.float64)
            self.floor = float(message["floor"])
            self.ground = 0.0
            self.height_offset = 0.0
            self.island_box = None
            self.colliders.clear()
            self.collision_dirty = True
            self.collision_at = time.monotonic()
            self.safe[:2] = 0
            self.reset()
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
            self.set_target(np.array(message["target"], dtype=np.float64) * self.sim_scale)
        elif kind == "roulade" and self.duck and not self.fly and self.recovery is None:
            self.roulade_steps = 50
            print("macroduck rolling")
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
        islands = []
        for name, group in self.colliders.items():
            for box in group:
                center = np.array(box[:3], dtype=np.float64) - np.array([self.origin[0], self.floor, self.origin[2]])
                center = WORLD_BASIS @ center * self.sim_scale
                half = np.array([box[3], box[5], box[4]], dtype=np.float64) * self.sim_scale
                rotation = WORLD_BASIS @ quat_matrix(box[6:10]) @ WORLD_BASIS.T
                converted = (center, half, matrix_quat(rotation))
                if name.startswith("island-") or name.startswith("ocean-"):
                    islands.append(converted)
                else:
                    boxes.extend(split_box(*converted, self.box_slots[-1][0]))
        position = self.data.qpos[:2]
        islands = [(np.sum(np.maximum(np.abs(center[:2] - position) - half[:2], 0) ** 2), center, half, quat) for center, half, quat in islands]
        island = min(islands, default=None, key=lambda item: (item[0], -(item[1][2] + item[2][2])))
        if island and island[0] == 0:
            _, center, half, quat = island
            ground = center[2] + half[2]
            if self.toddler:
                self.height_offset = ground
                boxes = [(center - np.array([0, 0, ground]), half, quat) for center, half, quat in boxes]
                ground = 0.0
                self.island_box = None
                self.data.mocap_pos[self.island_mocap] = [0, 0, -100]
                self.model.geom_contype[self.floor_geom], self.model.geom_conaffinity[self.floor_geom] = self.floor_contact
                self.model.pair_margin[self.floor_pairs] = self.floor_margins
            else:
                self.model.geom_size[self.island_geom] = np.maximum(half, 0.005)
                self.model.geom_rbound[self.island_geom] = np.linalg.norm(half)
                self.data.mocap_pos[self.island_mocap] = center
                self.data.mocap_quat[self.island_mocap] = quat
                self.island_box = (center, half, quat)
                self.model.geom_contype[self.floor_geom] = 0
                self.model.geom_conaffinity[self.floor_geom] = 0
        else:
            ground = 0.0
            self.height_offset = 0.0
            self.island_box = None
            self.data.mocap_pos[self.island_mocap] = [0, 0, -100]
            self.model.geom_contype[self.floor_geom], self.model.geom_conaffinity[self.floor_geom] = self.floor_contact
            self.model.pair_margin[self.floor_pairs] = self.floor_margins
        if abs(ground - self.ground) < 0.5 * self.sim_scale:
            self.data.qpos[2] += ground - self.ground
        self.ground = ground
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
        robot_half = np.array([0.45, 0.45, 0.9]) * self.sim_scale
        physical = [box for box in self.boxes if box[0][2] + box[1][2] > 0.05 * self.sim_scale or box[1][2] > 0.5 * self.sim_scale]
        candidates = []
        for box in physical:
            distance = np.sum(np.maximum(np.abs(box[0] - position) - box[1] - robot_half, 0) ** 2)
            group = next(index for index, (limit, _) in enumerate(self.box_slots) if max(box[1]) <= limit)
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
        for group in reversed(range(len(self.box_slots))):
            own = [candidate for candidate in candidates if candidate[1] == group]
            for candidate in own[:len(available[group])]:
                place_box(candidate, group)
            waiting.extend(own[len(self.slot_groups[group]):])
        for candidate in sorted(waiting, key=lambda item: item[0]):
            group = next((index for index in range(candidate[1], len(self.box_slots)) if available[index]), None)
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
            world = WORLD_BASIS.T @ (center * self.game_scale) + offset
            rotation = quat_matrix([quat[1], quat[2], quat[3], quat[0]])
            converted = matrix_quat(WORLD_BASIS.T @ rotation @ WORLD_BASIS)
            boxes.append([
                *world.tolist(), half[0] * self.game_scale, half[2] * self.game_scale, half[1] * self.game_scale,
                float(converted[1]), float(converted[2]), float(converted[3]), float(converted[0]),
            ])
        return boxes

    def navmesh(self):
        blocked = set()
        for center, half, _ in self.boxes:
            bottom = center[2] - half[2]
            top = center[2] + half[2]
            if top <= 0.65 * self.sim_scale or bottom >= 1.3 * self.sim_scale:
                continue
            radius = 0.22 * self.sim_scale
            x0 = math.floor((center[0] - half[0] - radius) / self.cell)
            x1 = math.ceil((center[0] + half[0] + radius) / self.cell)
            y0 = math.floor((center[1] - half[1] - radius) / self.cell)
            y1 = math.ceil((center[1] + half[1] + radius) / self.cell)
            for x in range(x0, x1 + 1):
                for y in range(y0, y1 + 1):
                    blocked.add((x, y))
        self.blocked = blocked
        if self.auto and any(tuple(np.floor(point / self.cell).astype(int)) in blocked for point in self.path):
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
            path.append(np.array([(current[0] + 0.5) * self.cell, (current[1] + 0.5) * self.cell]))
            current = came[current]
        path.reverse()
        return path

    def set_target(self, target):
        position = self.data.qpos[:2]
        delta = target - position
        distance = np.linalg.norm(delta)
        reach = 10 * self.sim_scale
        segment = target if distance <= reach else position + delta / distance * reach
        start = tuple(np.floor(position / self.cell).astype(int))
        goal = tuple(np.floor(segment / self.cell).astype(int))
        self.path = self.astar(start, goal)
        if not self.path and distance > 0.65 * self.sim_scale:
            self.path = [segment]
        self.target = target
        self.auto = bool(self.path)
        self.best = float("inf")
        self.progress_at = self.data.time
        print(f"{self.kind} target: {(self.target * self.game_scale).round(2)} waypoints: {len(self.path)}")

    def command(self):
        position = self.data.qpos[:2]
        quat = self.data.qpos[3:7]
        yaw = math.atan2(2 * (quat[0] * quat[3] + quat[1] * quat[2]), 1 - 2 * (quat[2] ** 2 + quat[3] ** 2))
        if not self.auto:
            if time.monotonic() - self.command_at > 0.25:
                self.manual[:] = 0
            return self.manual.copy(), yaw
        while self.path and np.linalg.norm(self.path[0] - position) < 0.65 * self.sim_scale:
            self.path.pop(0)
        if not self.path:
            if np.linalg.norm(self.target - position) >= 0.65 * self.sim_scale:
                self.set_target(self.target)
                return np.zeros(3, dtype=np.float32), yaw
            self.auto = False
            return np.zeros(3, dtype=np.float32), yaw
        waypoint = self.path[0]
        delta = waypoint - position
        desired = math.atan2(delta[1], delta[0])
        error = (desired - yaw + math.pi) % (2 * math.pi) - math.pi
        distance = np.linalg.norm(self.target - position)
        if distance < self.best - 0.15 * self.sim_scale:
            self.best = distance
            self.progress_at = self.data.time
        if self.data.time - self.progress_at > 4:
            self.set_target(self.target)
            return np.zeros(3, dtype=np.float32), yaw
        forward = 1.0 if abs(error) < 0.8 else 0.1
        return np.array([forward, 0, np.clip(error * 1.5, -1, 1)], dtype=np.float32), yaw

    def step(self):
        return self.duckStep() if self.duck else self.toddlerStep() if self.toddler else self.g1Step()

    def bodyVelocity(self, body):
        velocity = np.zeros(6)
        mujoco.mj_objectVelocity(self.model, self.data, mujoco.mjtObj.mjOBJ_BODY, body, velocity, 1)
        return velocity[:3].astype(np.float32)

    def hikeDepth(self):
        if self.depth_at == self.data.time:
            return self.depth_frame
        if self.renderer is None:
            self.renderer = mujoco.Renderer(self.model, height=36, width=64)
            self.renderer.enable_depth_rendering()
        self.renderer.update_scene(self.data, camera="depth_camera")
        depth = np.clip(self.renderer.render()[18:, 16:-16], 0, 2.5) / 2.5
        padded = np.pad(depth, 1, mode="edge")
        depth = (
            padded[:-2, :-2] + 2 * padded[:-2, 1:-1] + padded[:-2, 2:]
            + 2 * padded[1:-1, :-2] + 4 * padded[1:-1, 1:-1] + 2 * padded[1:-1, 2:]
            + padded[2:, :-2] + 2 * padded[2:, 1:-1] + padded[2:, 2:]
        ) / 16
        self.depth_frame = depth.astype(np.float32)
        if self.depth_history is None:
            self.depth_history = np.repeat(self.depth_frame[None], 37, axis=0)
        else:
            self.depth_history[:-1] = self.depth_history[1:]
            self.depth_history[-1] = self.depth_frame
        self.depth_at = self.data.time
        return self.depth_frame

    def hikeTarget(self, command, standing=False):
        history = self.stand_history if standing else self.hike_history
        ready = self.stand_ready if standing else self.hike_ready
        last = self.stand_last if standing else self.hike_last
        quat = self.data.xquat[self.trunk].copy()
        projected = rotate(np.array([quat[0], -quat[1], -quat[2], -quat[3]]), np.array([0, 0, -1.0]))
        frame = np.concatenate([
            self.bodyVelocity(self.trunk) * 0.25,
            projected,
            [command[0] * 0.5, 0, command[1] + command[2]],
            self.data.qpos[7:][HIKING_TO_G1] * HIKING_SIGN - HIKING_DEFAULT,
            self.data.qvel[6:][HIKING_TO_G1] * HIKING_SIGN * 0.05,
            last,
        ]).astype(np.float32)
        if ready:
            history[:-1] = history[1:]
            history[-1] = frame
        else:
            history[:] = frame
            if standing:
                self.stand_ready = True
            else:
                self.hike_ready = True
        proprio = np.concatenate([
            history[:, :3].ravel(), history[:, 3:6].ravel(), history[:, 6:9].ravel(),
            history[:, 9:38].ravel(), history[:, 38:67].ravel(), history[:, 67:].ravel(),
        ])
        self.hikeDepth()
        depth = self.depth_history[[1, 6, 11, 16, 21, 26, 31, 36]][None]
        depth_policy = self.stand_depth_policy if standing else self.depth_policy
        policy = self.stand_policy if standing else self.policy
        latent = depth_policy.run(None, {depth_policy.get_inputs()[0].name: depth})[0][0]
        actor_input = np.concatenate([proprio, latent])[None].astype(np.float32)
        last[:] = policy.run(None, {policy.get_inputs()[0].name: actor_input})[0][0]
        target = np.zeros(29, dtype=np.float32)
        target[HIKING_TO_G1] = (HIKING_DEFAULT + HIKING_SCALE * last) * HIKING_SIGN
        return target

    def phpDepth(self):
        if self.depth_at == self.data.time:
            return self.depth_frame
        if self.renderer is None:
            self.renderer = mujoco.Renderer(self.model, height=60, width=106)
            self.renderer.enable_depth_rendering()
        self.renderer.update_scene(self.data, camera="depth_camera")
        depth = self.renderer.render()[:-2, 4:-4]
        source = (np.arange(87) + 0.5) * depth.shape[1] / 87 - 0.5
        left = np.clip(np.floor(source).astype(int), 0, depth.shape[1] - 1)
        right = np.minimum(left + 1, depth.shape[1] - 1)
        amount = source - left
        depth = depth[:, left] * (1 - amount) + depth[:, right] * amount
        self.depth_frame = ((depth - 0.3) / 2.7 - 0.5).astype(np.float32)
        self.depth_at = self.data.time
        return self.depth_frame

    def phpTarget(self, command):
        turn = command[1] + command[2]
        if command[0] > 0.1:
            motion = 2 if turn > 0.15 else 4 if turn < -0.15 else 1
        else:
            motion = 3 if turn > 0.15 else 5 if turn < -0.15 else 0
        joystick = np.zeros(15, dtype=np.float32)
        joystick[motion + 5 if motion else 0] = 1
        quat = self.data.xquat[self.trunk].copy()
        projected = rotate(np.array([quat[0], -quat[1], -quat[2], -quat[3]]), np.array([0, 0, -1.0]))
        obs = np.concatenate([
            projected,
            self.data.qvel[3:6],
            self.data.qpos[7:][PHP_TO_G1] - PHP_DEFAULT,
            self.data.qvel[6:][PHP_TO_G1],
            self.php_last,
            joystick,
        ]).astype(np.float32)
        depth = self.phpDepth()[None]
        latent = self.depth_policy.run(None, {self.depth_policy.get_inputs()[0].name: depth})[0][0]
        self.php_depth.append(latent.copy())
        delayed = self.php_depth.pop(0) if len(self.php_depth) > 7 else self.php_depth[0]
        policy_obs = np.concatenate([obs, delayed])[None]
        feeds = {self.policy.get_inputs()[0].name: policy_obs, self.policy.get_inputs()[1].name: np.zeros((1, 1), dtype=np.float32)}
        self.php_last[:] = self.policy.run(None, feeds)[0][0]
        target = np.zeros(29, dtype=np.float32)
        target[PHP_TO_G1] = PHP_DEFAULT + PHP_SCALE * self.php_last
        return target

    def vanillaTarget(self, command):
        self.phase = (self.phase + 0.02 / 0.6) % 1.0
        quat = self.data.qpos[3:7].copy()
        projected = rotate(np.array([quat[0], -quat[1], -quat[2], -quat[3]]), np.array([0, 0, -1.0]))
        gait = np.array([math.sin(self.phase * math.tau), math.cos(self.phase * math.tau)], dtype=np.float32)
        obs = np.concatenate([
            self.data.sensor("imu_gyro").data.copy(), projected, command, gait,
            self.data.qpos[7:] - self.default, self.data.qvel[6:], self.last,
        ]).astype(np.float32)
        self.last[:] = self.policy.run(None, {self.policy_input: obs[None]})[0][0]
        return self.default + G1_SCALE * self.last

    def moveTarget(self, command, standing=False):
        if self.g1_mode == "hiking":
            return self.hikeTarget(command, standing)
        if self.g1_mode == "parkour":
            return self.phpTarget(command)
        return self.vanillaTarget(command)

    def resetPolicy(self, standing=False):
        if self.g1_mode == "hiking":
            history = self.stand_history if standing else self.hike_history
            history[:] = 0
            if standing:
                self.stand_ready = False
                self.stand_last[:] = 0
            else:
                self.hike_ready = False
                self.hike_last[:] = 0
        elif self.g1_mode == "parkour":
            self.php_last[:] = 0
            self.php_depth.clear()
        else:
            self.last[:] = 0
            self.phase = 0

    def startHandoff(self, retry=False):
        self.recovery = "handoff"
        self.recovery_steps = 0
        self.recovery_motion = 0.0
        self.fall_steps = 0
        self.upright_steps = 0
        self.recovery_from = self.target_q.copy()
        self.handoff_history[:] = 0
        self.handoff_ready = False
        self.handoff_last[:] = 0
        if retry:
            axis = 3 + self.recovery_attempts % 2
            self.data.qvel[2] = max(self.data.qvel[2], 0.35)
            self.data.qvel[axis] += 1.5 if self.recovery_attempts == 1 else -1.5
        else:
            self.recovery_attempts = 0

    def handoffTarget(self):
        quat = self.data.qpos[3:7].copy()
        roll = math.atan2(2 * (quat[0] * quat[1] + quat[2] * quat[3]), 1 - 2 * (quat[1] ** 2 + quat[2] ** 2))
        pitch = math.asin(np.clip(2 * (quat[0] * quat[2] - quat[3] * quat[1]), -1, 1))
        mimic = np.concatenate([[0, 0, 0.78, 0], HANDOFF_HANDS, [0, 1, 0, 1]]).astype(np.float32)
        proprio = np.concatenate([
            self.bodyVelocity(self.pelvis) * 0.25,
            [roll, pitch],
            self.data.qpos[7:] - HANDOFF_DEFAULT,
            self.data.qvel[6:] * HANDOFF_VEL_SCALE,
            self.handoff_last,
        ]).astype(np.float32)
        current = np.concatenate([mimic, proprio])
        if not self.handoff_ready:
            self.handoff_history[:] = current
            self.handoff_ready = True
        else:
            self.handoff_history[:-1] = self.handoff_history[1:]
            self.handoff_history[-1] = current
        obs = np.concatenate([current, self.handoff_history.ravel()])[None]
        action = self.handoff_policy.run(None, {self.handoff_policy.get_inputs()[0].name: obs})[0][0]
        self.handoff_last[:] = action
        return HANDOFF_DEFAULT + G1_SCALE * action

    def g1Step(self):
        if np.linalg.norm(self.data.qpos[:3] - self.collision_pos) > 0.5:
            self.nearBoxes()
        self.model.opt.gravity[2] = 0 if self.fly else -9.81
        command, yaw = self.command()
        quat = self.data.xquat[self.trunk].copy()
        projected = rotate(np.array([quat[0], -quat[1], -quat[2], -quat[3]]), np.array([0, 0, -1.0]))
        if self.jump and not self.fly and self.recovery is None and projected[2] < -0.8 and self.data.qpos[2] - self.ground < 1.0:
            self.data.qvel[2] = max(self.data.qvel[2], 1.8)
            self.jump_until = self.data.time + 0.45
        self.jump = False
        if self.recovery == "handoff":
            target = self.handoffTarget()
        elif self.recovery == "stand":
            target = self.moveTarget(np.zeros(3, dtype=np.float32), True)
        else:
            target = self.moveTarget(command)
        if self.recovery is not None and self.recovery_steps < 15:
            amount = (self.recovery_steps + 1) / 15
            self.target_q[:] = self.recovery_from * (1 - amount) + target * amount
        else:
            self.target_q[:] = target
        for _ in range(round(0.02 / self.model.opt.timestep)):
            if self.fly:
                self.data.qvel[2] = self.lift * 1.8
            elif self.data.time < self.jump_until:
                self.data.qvel[3:5] *= 0.5
            torque = G1_KP * (self.target_q - self.data.qpos[7:]) - G1_KD * self.data.qvel[6:]
            control = torque[PHP_TO_G1] if self.g1_mode == "parkour" else torque
            self.data.ctrl[:] = np.clip(control, self.model.actuator_ctrlrange[:, 0], self.model.actuator_ctrlrange[:, 1])
            mujoco.mj_step(self.model, self.data)

        quat = self.data.xquat[self.trunk].copy()
        projected = rotate(np.array([quat[0], -quat[1], -quat[2], -quat[3]]), np.array([0, 0, -1.0]))
        angular = np.linalg.norm(self.bodyVelocity(self.trunk))
        height = self.data.qpos[2] - self.ground
        fallen = projected[2] > -0.55 or height < 0.45 or (projected[2] > -0.8 and angular > 4)
        upright = projected[2] < -0.94 and height > 0.68 and angular < 1
        if not fallen and self.recovery is None and np.linalg.norm(self.data.qvel[:2]) < 2:
            self.safe[:] = self.data.qpos
        if self.recovery == "handoff":
            self.recovery_steps += 1
            self.recovery_motion += np.linalg.norm(self.data.qvel) * 0.02
            self.upright_steps = self.upright_steps + 1 if upright else 0
            if self.upright_steps >= 25:
                print("g1 recovered, standing")
                self.recovery = "stand"
                self.recovery_steps = 0
                self.upright_steps = 0
                self.recovery_from = self.target_q.copy()
                self.resetPolicy(True)
            elif self.recovery_steps % 100 == 0 and self.recovery_motion < 0.5:
                self.recovery_attempts += 1
                if self.recovery_attempts >= 3:
                    print("g1 recovery stalled, respawned")
                    self.reset()
                    fallen = False
                else:
                    print(f"g1 recovery stalled, retry {self.recovery_attempts}")
                    self.startHandoff(True)
            elif self.recovery_steps % 100 == 0:
                self.recovery_motion = 0.0
            elif self.recovery_steps >= 600:
                print("g1 recovery failed, respawned")
                self.reset()
                fallen = False
        elif self.recovery == "stand":
            self.recovery_steps += 1
            if fallen:
                self.fall_steps += 1
                if self.fall_steps >= 5:
                    print("g1 fell during stand")
                    self.startHandoff()
            elif self.recovery_steps >= 75:
                print("g1 walking resumed")
                self.recovery = "resume"
                self.recovery_steps = 0
                self.fall_steps = 0
                self.recovery_from = self.target_q.copy()
                self.resetPolicy()
        elif self.recovery == "resume":
            self.recovery_steps += 1
            if fallen:
                self.fall_steps += 1
                if self.fall_steps >= 5:
                    self.startHandoff()
            elif self.recovery_steps >= 15:
                self.recovery = None
                self.recovery_steps = 0
                self.fallen_at = None
        elif fallen:
            self.fall_steps += 1
            if self.fall_steps >= 25:
                print("g1 fell, recovering")
                self.fallen_at = self.data.time
                self.startHandoff()
        else:
            self.fall_steps = 0
        return self.poseData(yaw, fallen)

    def duckStep(self):
        if np.linalg.norm(self.data.qpos[:3] - self.collision_pos) > 0.5 * self.sim_scale:
            self.nearBoxes()
        self.model.opt.gravity[2] = 0 if self.fly else -9.81
        command, yaw = self.command()
        self.jump = False
        rolling = self.roulade_steps > 0
        quat = self.data.xquat[self.trunk].copy()
        projected = rotate(np.array([quat[0], -quat[1], -quat[2], -quat[3]]), np.array([0, 0, -1.0]))
        policy_command = np.zeros(13, dtype=np.float32)
        if self.recovery is None and not rolling:
            policy_command[:3] = [command[0] * 0.4, 0, np.clip(command[2] + command[1], -1, 1)]
        sensor_at = self.model.sensor_adr[self.imu]
        obs = np.concatenate([
            self.data.sensordata[sensor_at : sensor_at + 3], projected,
            self.data.qpos[self.joint_qpos] - self.default, self.data.qvel[self.joint_qvel], self.last,
            policy_command,
        ]).astype(np.float32)
        if self.recovery != "settle":
            session = self.recovery_policy if self.recovery == "recover" else self.roulade_policy if rolling else self.policy
            self.last = session.run(None, {self.policy_input: obs[None]})[0][0]
            self.data.ctrl[:] = self.default + self.last
        for _ in range(round(0.02 / self.model.opt.timestep)):
            if self.fly:
                self.data.qvel[2] = self.lift * 1.8 * self.sim_scale
            mujoco.mj_step(self.model, self.data)

        if rolling:
            self.roulade_steps -= 1
            if self.roulade_steps == 0:
                print("macroduck rolled")

        quat = self.data.xquat[self.trunk].copy()
        projected = rotate(np.array([quat[0], -quat[1], -quat[2], -quat[3]]), np.array([0, 0, -1.0]))
        fallen = not rolling and (projected[2] > -0.5 or self.data.qpos[2] - self.ground < 0.06)
        if self.recovery is None and not rolling and not fallen and np.linalg.norm(self.data.qvel[:2]) < 0.5:
            self.safe[:] = self.data.qpos
        if self.recovery == "settle":
            self.recovery_steps += 1
            if self.recovery_steps >= 15:
                self.recovery = "recover"
                self.recovery_steps = 0
                self.last[:] = 0
        elif self.recovery == "recover":
            self.recovery_steps += 1
            self.upright_steps = self.upright_steps + 1 if projected[2] < -0.85 else 0
            if self.upright_steps >= 50:
                self.recovery = None
                self.fallen_at = None
                self.last[:] = 0
                print("macroduck recovered")
            elif self.recovery_steps >= 300:
                print("macroduck respawned")
                target = self.target.copy()
                auto = self.auto
                self.reset()
                if auto:
                    self.set_target(target)
                fallen = False
        elif fallen:
            self.fall_steps += 1
            if self.fall_steps >= 10:
                self.fall_steps = 0
                self.recovery = "settle"
                self.recovery_steps = 0
                self.fallen_at = self.data.time
                print("macroduck fell")
        else:
            self.fall_steps = 0
        return self.poseData(yaw, fallen)

    def toddlerMotion(self):
        rotation = self.data.xmat[self.trunk].reshape(3, 3)
        if rotation[2, 0] < -0.5:
            motor_pos = self.data.qpos[self.joint_qpos]
            left_down = -math.pi / 2 < motor_pos[16] < math.pi / 2
            right_down = -math.pi / 2 < motor_pos[23] < math.pi / 2
            mode = 0 if left_down and right_down else 1 if not left_down and not right_down else 2 if left_down else 3
            name = ["prone", "prone_left", "prone_right", "prone_both"][mode]
        else:
            name = "roll" if abs(rotation[2, 1]) < 0.1736 else "roll_left" if rotation[2, 1] > 0 else "roll_right"
        print(f"toddler recovery: {name}")
        return self.toddler_motions[name]

    def toddlerStep(self):
        if np.linalg.norm(self.data.qpos[:3] - self.collision_pos) > 0.5:
            self.nearBoxes()
        self.model.opt.gravity[2] = 0 if self.fly else -9.81
        command, yaw = self.command()
        self.jump = False
        walk = np.array([command[0] * (0.1 if command[0] > 0 else 0.03), command[1] * 0.05, command[2] * 0.8], dtype=np.float32)
        if command[0] > 0:
            walk[1] += 0.03
        elif command[0] < 0:
            walk[1] -= 0.01
        walk[1] = np.clip(walk[1], -0.05, 0.05)
        self.target_yaw += walk[2] * 0.02
        quat = self.data.xquat[self.trunk].copy()
        torso_yaw = math.atan2(2 * (quat[0] * quat[3] + quat[1] * quat[2]), 1 - 2 * (quat[2] ** 2 + quat[3] ** 2))
        yaw_error = (self.target_yaw - torso_yaw + math.pi) % (2 * math.pi) - math.pi
        if abs(yaw_error) <= 0.2:
            walk[2] = 0
        elif walk[2] == 0:
            walk[:] = [0, 0, 0.8 if yaw_error > 0 else -0.2]

        if self.recovery == "recover":
            blend_steps = 75
            if self.recovery_steps < blend_steps:
                amount = (self.recovery_steps + 1) / blend_steps
                self.target_q[:] = self.recovery_from * (1 - amount) + self.recovery_motion[0] * amount
            else:
                frame = min(self.recovery_steps - blend_steps, len(self.recovery_motion) - 1)
                self.target_q[:] = self.recovery_motion[frame]
        else:
            motor_pos = self.data.qpos[self.joint_qpos].copy()
            motor_delta = motor_pos - self.default
            motor_delta[23:30] = 0
            motor_delta[0:2] = 0
            motor_delta[16:23] = 0
            motor_vel = self.data.qvel[self.joint_qvel].copy()
            if quat[0] < 0:
                quat = -quat
            ang_vel = rotate(np.array([quat[0], -quat[1], -quat[2], -quat[3]]), self.data.cvel[self.trunk, :3])
            phase = np.array([
                math.sin(math.tau * self.data.time / 0.72),
                math.cos(math.tau * self.data.time / 0.72),
            ], dtype=np.float32)
            obs = np.concatenate([phase, walk, motor_delta, motor_vel * 0.05, self.last, ang_vel, quat]).astype(np.float32)
            self.history[obs.size:] = self.history[:-obs.size]
            self.history[:obs.size] = obs
            action = self.policy.run(None, {self.policy_input: self.history[None]})[0][0]
            self.action_buffer[12:] = self.action_buffer[:12]
            self.action_buffer[:12] = action
            self.last[:] = self.action_buffer[12:]
            self.target_q[:] = self.default
            self.target_q[4:16] += 0.25 * self.last

        kp, tau_max, qd_max, tau_qd, qd_tau, tau_brake, kd_min = TODDLER_CONTROL
        for _ in range(20):
            if self.fly:
                self.data.qvel[2] = self.lift * 1.8
            q = self.data.qpos[self.joint_qpos]
            qd = self.data.qvel[self.joint_qvel]
            error = self.target_q - q
            real_kp = np.where(self.data.qacc[self.joint_qvel] * error < 0, kp * 3, kp)
            torque = real_kp * error - kd_min * qd
            speed = np.abs(qd)
            taper = tau_max + (tau_qd - tau_max) / (qd_max - qd_tau) * (speed - qd_tau)
            accel = np.where(speed <= qd_tau, tau_max, taper)
            self.data.ctrl[:] = np.where(
                (speed > qd_max) & (qd * self.target_q > 0),
                np.where(qd > 0, -tau_brake, tau_brake),
                np.where(qd > 0, np.clip(torque, -tau_brake, accel), np.clip(torque, -accel, tau_brake)),
            )
            mujoco.mj_step(self.model, self.data)

        quat = self.data.xquat[self.trunk].copy()
        projected = rotate(np.array([quat[0], -quat[1], -quat[2], -quat[3]]), np.array([0, 0, -1.0]))
        fallen = projected[2] > -0.5 or self.data.qpos[2] - self.ground < 0.18
        if not fallen and self.recovery is None and np.linalg.norm(self.data.qvel[:2]) < 0.5:
            self.safe[:] = self.data.qpos
        if self.recovery == "recover":
            self.recovery_steps += 1
            if self.recovery_steps >= 75 + len(self.recovery_motion):
                if fallen:
                    if self.recovery_attempts < 3:
                        self.recovery_attempts += 1
                        self.recovery_steps = 0
                        self.recovery_from = self.data.qpos[self.joint_qpos].copy()
                        self.recovery_motion = self.toddlerMotion()
                    else:
                        print("toddler recovery failed, respawned")
                        self.reset()
                        fallen = False
                else:
                    print("toddler recovered")
                    self.recovery = None
                    self.recovery_motion = None
                    self.recovery_from = None
                    self.recovery_attempts = 0
                    self.recovery_steps = 0
                    self.fallen_at = None
                    self.fall_steps = 0
                    self.history[:] = 0
                    self.action_buffer[:] = 0
                    self.last[:] = 0
                    self.target_yaw = torso_yaw
        elif fallen:
            self.fall_steps += 1
            if self.fall_steps >= 20:
                self.fall_steps = 0
                self.fallen_at = self.data.time
                self.recovery = "recover"
                self.recovery_attempts = 1
                self.recovery_steps = 0
                self.recovery_from = self.data.qpos[self.joint_qpos].copy()
                self.recovery_motion = self.toddlerMotion()
                print("toddler fell")
        else:
            self.fall_steps = 0
        return self.poseData(yaw, fallen)

    def poseData(self, yaw, fallen):
        root = self.data.qpos[:3].copy()
        root[2] += self.height_offset
        pose = {
            "type": "pose",
            "root": (root * self.game_scale).tolist(),
            "bodies": self.body_poses(),
            "yaw": float(yaw),
            "fallen": bool(fallen),
            "target": (self.target * self.game_scale).tolist(),
            "auto": self.auto,
        }
        if self.debug_dirty:
            pose["colliders"] = self.debugBoxes()
            self.debug_dirty = False
        if not self.duck and not self.toddler:
            pose["model"] = self.g1_mode
            if self.g1_mode == "hiking":
                self.hikeDepth()
                pixels = np.clip(self.depth_frame * 255, 0, 255).astype(np.uint8)
                pose["depth"] = base64.b64encode(pixels.tobytes()).decode()
                pose["depthSize"] = [32, 18]
            elif self.g1_mode == "parkour":
                self.phpDepth()
                pixels = np.clip((self.depth_frame + 0.5) * 255, 0, 255).astype(np.uint8)
                pose["depth"] = base64.b64encode(pixels.tobytes()).decode()
                pose["depthSize"] = [87, 58]
        return pose

    def body_poses(self):
        poses = []
        for body in self.body_ids:
            quat = self.data.xquat[body]
            rotation = quat_matrix([quat[1], quat[2], quat[3], quat[0]])
            converted = matrix_quat(BASIS.T @ rotation @ BASIS)
            position = self.data.xpos[body].copy()
            position[2] += self.height_offset
            poses.append([
                *(position * self.game_scale).tolist(),
                float(converted[1]), float(converted[2]), float(converted[3]), float(converted[0]),
            ])
        return poses

g1s = {mode: Robot("g1", mode) for mode in ["vanilla", "hiking", "parkour"]}
robots = {"g1": g1s["vanilla"], "duck": Robot("duck"), "toddler": Robot("toddler")}
active = g1s["vanilla"]


async def connect(socket):
    global active
    selected = None
    try:
        async for raw in socket:
            message = json.loads(raw)
            if message.get("type") == "hello":
                selected = g1s.get(message.get("model"), g1s["vanilla"]) if message.get("robot") == "g1" else robots.get(message.get("robot"), robots["g1"])
                active = selected
                selected.client = socket
                print(f"{selected.kind} connected")
            elif message.get("type") == "model" and selected and selected.kind == "g1":
                switched = g1s.get(message.get("model"))
                if switched and switched is not selected:
                    switched.takeState(selected)
                    selected.client = None
                    selected = switched
                    selected.client = socket
                    active = selected
                    print(f"g1 model: {selected.g1_mode}")
            if selected:
                selected.message(message)
    except websockets.ConnectionClosed:
        pass
    finally:
        if selected and selected.client is socket:
            selected.client = None
            print(f"{selected.kind} disconnected")


async def simulate():
    while True:
        started = asyncio.get_running_loop().time()
        selected = active
        if selected.collision_dirty and time.monotonic() - selected.collision_at > 0.5:
            selected.collision_dirty = False
            selected.collide()
        if selected.client:
            try:
                await selected.client.send(json.dumps(selected.step()))
            except websockets.ConnectionClosed:
                selected.client = None
        elapsed = asyncio.get_running_loop().time() - started
        await asyncio.sleep(max(0, 0.02 - elapsed))


async def main():
    async with websockets.serve(connect, "127.0.0.1", 8765, max_size=64 * 1024 * 1024):
        print("robot server: ws://127.0.0.1:8765")
        await simulate()


if __name__ == "__main__":
    asyncio.run(main())
