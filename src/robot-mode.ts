import { VoxelSize } from '../common/voxels/constants'
import { mergeBoxes } from '../common/voxels/boxes'
import type Controls from './controls/controls'
import type Grid from './grid'

type Box = [number, number, number, number, number, number, number, number, number, number]
type Pose = { type: 'pose'; root: number[]; bodies: number[][]; yaw: number; fallen: boolean; target: number[]; auto: boolean; colliders?: Box[] }

const ROBOT_BODIES = [
  'pelvis',
  'left_hip_pitch_link',
  'left_hip_roll_link',
  'left_hip_yaw_link',
  'left_knee_link',
  'left_ankle_pitch_link',
  'left_ankle_roll_link',
  'right_hip_pitch_link',
  'right_hip_roll_link',
  'right_hip_yaw_link',
  'right_knee_link',
  'right_ankle_pitch_link',
  'right_ankle_roll_link',
  'waist_yaw_link',
  'waist_roll_link',
  'torso_link',
  'left_shoulder_pitch_link',
  'left_shoulder_roll_link',
  'left_shoulder_yaw_link',
  'left_elbow_link',
  'left_wrist_roll_link',
  'left_wrist_pitch_link',
  'left_wrist_yaw_link',
  'right_shoulder_pitch_link',
  'right_shoulder_roll_link',
  'right_shoulder_yaw_link',
  'right_elbow_link',
  'right_wrist_roll_link',
  'right_wrist_pitch_link',
  'right_wrist_yaw_link',
]

export default class RobotMode {
  private socket: WebSocket | null = null
  private origin: BABYLON.Vector3
  private floor: number
  private pose: Pose | null = null
  private colliders = new Map<string, Box[]>()
  private robotRoot: BABYLON.TransformNode | null = null
  private robot: BABYLON.TransformNode[] = []
  private headMeshes: BABYLON.AbstractMesh[] = []
  private auto = false
  private jump = false
  private sentAt = 0
  private marker: BABYLON.Mesh
  private debugMesh: BABYLON.Mesh
  private debug = false
  private held = new Set<string>()
  private facing = BABYLON.Vector3.Zero()
  private head = BABYLON.Vector3.Zero()
  private offset = BABYLON.Vector3.Zero()

  constructor(
    private scene: BABYLON.Scene,
    private controls: Controls,
    private grid: Grid,
  ) {
    const body = (controls as any).body
    this.origin = body.position.clone()
    this.floor = this.origin.y - 1.65
    ;(window as any).robotMode = this
    ;(controls as any).enterThirdPerson()
    this.marker = this.makeMarker()
    this.debugMesh = this.makeBoxes()
    void this.makeRobot()
    document.addEventListener('keydown', (event) => this.keyDown(event), true)
    document.addEventListener('keyup', (event) => this.held.delete(event.code), true)
    for (const parcel of grid.parcels.values()) this.parcelAdd(parcel)
    for (const mesh of scene.meshes) if ((mesh as any).robotCollider) this.voxAdd(mesh.name, mesh)
    this.connect()
    scene.onBeforeRenderObservable.add(() => this.step())
  }

  parcelAdd(parcel: any) {
    const coords = parcel.colliderVoxels as Int32Array | undefined
    if (!coords?.length) return
    const origin = parcel.colliderOrigin()
    const filled = new Set<string>()
    for (let i = 0; i < coords.length; i += 3) filled.add(`${coords[i]},${coords[i + 1]},${coords[i + 2]}`)
    const merged = mergeBoxes(filled)
    const boxes: Box[] = []
    for (let i = 0; i < merged.length; i += 6) {
      const [x, y, z, dx, dy, dz] = merged.slice(i, i + 6)
      boxes.push([origin.x + (x + dx / 2) * VoxelSize, origin.y + (y + dy / 2) * VoxelSize, origin.z + (z + dz / 2) * VoxelSize, (dx * VoxelSize) / 2, (dy * VoxelSize) / 2, (dz * VoxelSize) / 2, 0, 0, 0, 1])
    }
    this.send(`parcel-${parcel.id}`, boxes)
  }

  parcelDrop(parcel: any) {
    this.drop(`parcel-${parcel.id}`)
  }

  voxAdd(id: string, mesh: BABYLON.AbstractMesh) {
    const local = (mesh as any).robotCollider as number[] | undefined
    if (!local?.length) return
    const matrix = mesh.computeWorldMatrix(true)
    const scale = new BABYLON.Vector3()
    const rotation = new BABYLON.Quaternion()
    matrix.decompose(scale, rotation)
    const boxes: Box[] = []
    for (let i = 0; i < local.length; i += 6) {
      const center = BABYLON.Vector3.TransformCoordinates(BABYLON.Vector3.FromArray(local, i), matrix)
      boxes.push([center.x, center.y, center.z, Math.abs(local[i + 3] * scale.x), Math.abs(local[i + 4] * scale.y), Math.abs(local[i + 5] * scale.z), rotation.x, rotation.y, rotation.z, rotation.w])
    }
    this.send(`vox-${id}`, boxes)
  }

  voxDrop(id: string) {
    this.drop(`vox-${id}`)
  }

  private connect() {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return
    const socket = new WebSocket('ws://127.0.0.1:8765')
    this.socket = socket
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'hello', origin: this.origin.asArray(), floor: this.floor }))
      for (const [id, boxes] of this.colliders) socket.send(JSON.stringify({ type: 'collider', id, boxes }))
    }
    socket.onmessage = (event) => {
      const pose = JSON.parse(event.data)
      if (pose.type === 'pose') {
        this.pose = pose
        if (pose.colliders) this.showBoxes(pose.colliders)
      }
    }
    socket.onclose = () => {
      if (this.socket !== socket) return
      this.socket = null
      setTimeout(() => this.connect(), 3000)
    }
  }

  private send(id: string, boxes: Box[]) {
    this.colliders.set(id, boxes)
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'collider', id, boxes }))
  }

  private drop(id: string) {
    this.colliders.delete(id)
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'drop', id }))
  }

  private keyDown(event: KeyboardEvent) {
    if (!event.repeat && event.code === 'KeyH') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.debug = !this.debug
      this.debugMesh.setEnabled(this.debug)
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'debug', enabled: this.debug }))
      return
    }
    if (!event.repeat && event.code === 'KeyR') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.auto = false
      this.marker.setEnabled(false)
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'respawn' }))
      return
    }
    if (!event.repeat && (event.code === 'KeyC' || event.code === 'KeyF')) {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.code === 'KeyC') (this.controls as any).togglePerspective()
      else (this.controls as any).toggleFlying()
      return
    }
    this.held.add(event.code)
    if (event.code === 'Space' && !event.repeat && !(this.controls as any).flying) {
      this.auto = false
      this.jump = true
    }
    if (event.code !== 'KeyG' || event.repeat) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const locked = document.pointerLockElement !== null
    const pick = (this.controls as any).pickAtView(locked ? undefined : this.scene.pointerX, locked ? undefined : this.scene.pointerY)
    if (!pick?.pickedPoint || this.socket?.readyState !== WebSocket.OPEN) return
    const point = pick.pickedPoint as BABYLON.Vector3
    this.auto = true
    this.marker.position.copyFrom(point).addInPlaceFromFloats(0, 0.05, 0)
    this.marker.setEnabled(true)
    this.socket.send(JSON.stringify({ type: 'target', target: [this.origin.x - point.x, this.origin.z - point.z] }))
  }

  private sendInput() {
    if (this.socket?.readyState !== WebSocket.OPEN || performance.now() - this.sentAt < 50) return
    const forward = Number(this.held.has('KeyW') || this.held.has('ArrowUp')) - Number(this.held.has('KeyS') || this.held.has('ArrowDown'))
    const side = Number(this.held.has('KeyA') || this.held.has('ArrowLeft')) - Number(this.held.has('KeyD') || this.held.has('ArrowRight'))
    const turn = Number(this.held.has('KeyQ')) - Number(this.held.has('KeyE'))
    const walking = forward !== 0 || side !== 0 || turn !== 0
    const moving = walking || this.jump
    if (moving) {
      this.auto = false
      this.marker.setEnabled(false)
    }
    if (this.auto) return
    const flying = (this.controls as any).flying as boolean
    const lift = flying ? Number(this.held.has('Space') || this.held.has('PageUp')) - Number(this.held.has('KeyV') || this.held.has('PageDown')) : 0
    this.socket.send(JSON.stringify({ type: 'command', move: [forward, side * 0.5, turn], jump: this.jump, fly: flying, lift }))
    this.jump = false
    this.sentAt = performance.now()
  }

  private makeMarker() {
    const marker = BABYLON.MeshBuilder.CreateTorus('robot-target', { diameter: 0.55, thickness: 0.06, tessellation: 24 }, this.scene)
    const material = new BABYLON.StandardMaterial('robot-target', this.scene)
    material.disableLighting = true
    material.emissiveColor.set(0.1, 1, 0.4)
    material.freeze()
    marker.material = material
    marker.isPickable = false
    marker.setEnabled(false)
    return marker
  }

  private makeBoxes() {
    const mesh = BABYLON.MeshBuilder.CreateBox('robot-colliders', { size: 1 }, this.scene)
    const material = new BABYLON.StandardMaterial('robot-colliders', this.scene)
    material.disableLighting = true
    material.emissiveColor.set(1, 0.1, 0.05)
    material.alpha = 0.35
    material.wireframe = true
    material.freeze()
    mesh.material = material
    mesh.isPickable = false
    mesh.alwaysSelectAsActiveMesh = true
    mesh.setEnabled(false)
    return mesh
  }

  private showBoxes(boxes: Box[]) {
    const matrices = new Float32Array(boxes.length * 16)
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]
      BABYLON.Matrix.Compose(new BABYLON.Vector3(box[3] * 2, box[4] * 2, box[5] * 2), new BABYLON.Quaternion(box[6], box[7], box[8], box[9]), new BABYLON.Vector3(box[0], box[1], box[2])).copyToArray(matrices, i * 16)
    }
    this.debugMesh.thinInstanceSetBuffer('matrix', matrices, 16, true)
  }

  private step() {
    if (!this.pose) return
    const body = (this.controls as any).body
    body.position.set(this.origin.x - this.pose.root[0], this.origin.y + this.pose.root[2] - 0.8, this.origin.z - this.pose.root[1])
    body.velocity?.setAll(0)
    const camera = (this.controls as any).camera
    ;(this.controls as any).move.setAll(0)
    this.facing.set(0, this.pose.yaw + Math.PI / 2, 0)
    ;(this.controls as any).persona.update(body.position, this.facing, this.controls)
    const avatar = (this.controls as any).persona.avatar
    avatar?.avatarMesh?.setEnabled(false)
    this.moveRobot(this.pose.bodies)
    this.sendInput()
    ;(camera as any).place()
    if ((this.controls as any).firstPersonView) camera.position.copyFrom(this.headPoint())
    else camera.position.y -= 0.75
    for (const mesh of this.headMeshes) mesh.setEnabled(!(this.controls as any).firstPersonView)
    if (!this.pose.auto) this.marker.setEnabled(false)
  }

  private async makeRobot() {
    const loaded = await BABYLON.SceneLoader.ImportMeshAsync(null, '/models/', 'g1.glb', this.scene)
    for (const mesh of loaded.meshes) mesh.isPickable = false
    this.robotRoot = loaded.meshes.find((mesh) => mesh.name === '__root__')!
    this.robotRoot.position.set(this.origin.x, this.floor, this.origin.z)
    const nodes = (loaded as any).transformNodes as BABYLON.TransformNode[]
    this.robot = ROBOT_BODIES.map((name) => nodes.find((node) => node.name === `g1:${name}`)!)
    this.headMeshes = this.robot[15].getChildMeshes()
  }

  private moveRobot(bodies: number[][]) {
    if (bodies.length !== this.robot.length) return
    for (let i = 0; i < bodies.length; i++) {
      const pose = bodies[i]
      this.robot[i].position.set(pose[0], pose[2], -pose[1])
      const rotation = (this.robot[i].rotationQuaternion ||= BABYLON.Quaternion.Identity())
      rotation.set(pose[3], pose[4], pose[5], pose[6])
    }
  }

  private headPoint() {
    this.offset.set(0, 0.34, 0)
    BABYLON.Vector3.TransformCoordinatesToRef(this.offset, this.robot[15].computeWorldMatrix(true), this.head)
    return this.head
  }
}
