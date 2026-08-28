import { VoxelSize } from '../common/voxels/constants'
import { mergeBoxes } from '../common/voxels/boxes'
import type Controls from './controls/controls'
import type Grid from './grid'

type Box = [number, number, number, number, number, number, number, number, number, number]
type Pose = { type: 'pose'; root: number[]; bodies: number[][]; yaw: number; fallen: boolean; target: number[]; auto: boolean; model?: G1Model; colliders?: Box[]; depth?: string; depthSize?: number[] }
type RobotKind = 'g1' | 'duck' | 'toddler'
type G1Model = 'vanilla' | 'hiking' | 'parkour'
type RobotInfo = { file: string; prefix: string; bodies: string[]; scale: number; head: number; headOffset: [number, number, number]; camera?: number; cameraOffset: number }

const ROBOTS: Record<RobotKind, RobotInfo> = {
  g1: {
    file: 'g1.glb',
    prefix: 'g1',
    bodies: [
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
    ],
    scale: 1,
    head: 15,
    headOffset: [0, 0.34, 0],
    cameraOffset: 0.75,
  },
  duck: {
    file: 'macroduck.glb',
    prefix: 'macroduck',
    bodies: ['trunk_base', 'yaw2roll', 'hip_l', 'upper_leg_left', 'leg', 'ankle_left', 'neck', 'neck_pitch', 'yaw_roll_motion', 'jaw_soft', 'bearing_roll', 'hip_l_2', 'upper_leg_right', 'leg_2', 'ankle_right'],
    scale: 8,
    head: 9,
    headOffset: [0.12 / 8, -0.59 / 8, 0],
    camera: 4,
    cameraOffset: 0.65,
  },
  toddler: {
    file: 'toddler.glb',
    prefix: 'toddler',
    bodies: [
      'torso',
      'neck_yaw_gear_drive',
      'neck_yaw_link',
      'head',
      'neck_pitch_plate',
      'neck_rod',
      'neck_rod_2',
      'waist_gears',
      'pelvis_link',
      'waist_gear_drive',
      'waist_gear_drive_2',
      'left_hip_pitch_link',
      'left_hip_roll_link',
      'left_hip_yaw_link',
      'left_hip_yaw_gear_drive',
      'left_knee_link',
      'left_ankle_pitch_link',
      'left_ankle_roll_link',
      'right_hip_pitch_link',
      'right_hip_roll_link',
      'right_hip_yaw_link',
      'right_hip_yaw_gear_drive',
      'right_knee_link',
      'right_ankle_pitch_link',
      'right_ankle_roll_link',
      'left_shoulder_pitch_link',
      'left_shoulder_roll_link',
      'left_shoulder_gear_drive',
      'left_shoulder_yaw_link',
      'left_elbow_roll_link',
      'left_elbow_gear_drive',
      'left_elbow_yaw_link',
      'left_wrist_pitch_link',
      'left_wrist_gear_drive',
      'left_hand',
      'right_shoulder_pitch_link',
      'right_shoulder_roll_link',
      'right_shoulder_gear_drive',
      'right_shoulder_yaw_link',
      'right_elbow_roll_link',
      'right_elbow_gear_drive',
      'right_elbow_yaw_link',
      'right_wrist_pitch_link',
      'right_wrist_gear_drive',
      'right_hand',
    ],
    scale: 2,
    head: 3,
    headOffset: [0, 0, 0],
    cameraOffset: 1.05,
  },
}

export default class RobotMode {
  private socket: WebSocket | null = null
  private origin: BABYLON.Vector3
  private floor: number
  private pose: Pose | null = null
  private colliders = new Map<string, Box[]>()
  private island = ''
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
  private kind: RobotKind
  private info: RobotInfo
  private g1Model: G1Model
  private depthCanvas = document.createElement('canvas')
  private depthImage: ImageData

  constructor(
    private scene: BABYLON.Scene,
    private controls: Controls,
    private grid: Grid,
  ) {
    const query = new URLSearchParams(location.search)
    const kind = query.get('robot')
    this.kind = kind === 'duck' || kind === 'toddler' ? kind : 'g1'
    this.g1Model = 'vanilla'
    this.info = ROBOTS[this.kind]
    this.depthCanvas.width = 32
    this.depthCanvas.height = 18
    this.depthCanvas.hidden = true
    Object.assign(this.depthCanvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', zIndex: '100', imageRendering: 'pixelated', pointerEvents: 'none' })
    document.body.append(this.depthCanvas)
    this.depthImage = this.depthCanvas.getContext('2d')!.createImageData(32, 18)
    const body = (controls as any).body
    this.origin = body.position.clone()
    this.floor = this.origin.y - 1.65
    ;(window as any).robotMode = this
    if (this.info.camera) (controls as any).enterThirdPerson(this.info.camera)
    else (controls as any).enterThirdPerson()
    this.marker = this.makeMarker()
    this.debugMesh = this.makeBoxes()
    void this.makeRobot()
    document.addEventListener('keydown', (event) => this.keyDown(event), true)
    document.addEventListener('keyup', (event) => this.keyUp(event), true)
    for (const parcel of grid.parcels.values()) this.parcelAdd(parcel)
    for (const mesh of scene.meshes) if ((mesh as any).robotCollider) this.voxAdd(mesh.name, mesh)
    const terrain = (window as any).environment?.terrain
    for (const island of terrain?.islands?.islands || []) this.cliffAdd(island)
    this.islandStep(this.origin)
    const oceanFloor = terrain?.oceanFloor
    const oceanHalf = oceanFloor?.mesh.getBoundingInfo().boundingBox.extendSize.x
    for (const mesh of oceanFloor?.getInstances() || []) this.oceanAdd(mesh.name.slice('ocean_floor_i_'.length).replace('_', '-'), mesh.position, oceanHalf)
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

  islandAdd(id: string, mesh: BABYLON.AbstractMesh) {
    mesh.computeWorldMatrix(true)
    const bounds = mesh.getBoundingInfo().boundingBox
    const center = bounds.centerWorld
    const half = bounds.extendSizeWorld
    this.send(`island-${id}`, [[center.x, center.y, center.z, half.x, half.y, half.z, 0, 0, 0, 1]])
  }

  cliffAdd(island: any) {
    island.mesh.computeWorldMatrix(true)
    const bounds = island.mesh.getBoundingInfo().boundingBox
    const top = bounds.maximumWorld.y
    const bottom = bounds.minimumWorld.y
    const boxes: Box[] = []
    for (const ring of island.desc.geometry.coordinates) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        const dx = (b[0] - a[0]) * 100
        const dz = (b[1] - a[1]) * 100
        const length = Math.hypot(dx, dz)
        if (!length) continue
        const rotation = BABYLON.Quaternion.RotationYawPitchRoll(Math.atan2(-dz, dx), 0, 0)
        boxes.push([(a[0] + b[0]) * 50, (top + bottom) / 2, (a[1] + b[1]) * 50, length / 2, (top - bottom) / 2, 0.05, rotation.x, rotation.y, rotation.z, rotation.w])
      }
    }
    this.send(`cliff-${island.desc.id}`, boxes)
  }

  islandStep(position: BABYLON.Vector3) {
    const island = (window as any).environment?.terrain?.islands?.getIsland(new BABYLON.Vector2(position.x, position.z))
    const id = island ? String(island.desc.id) : ''
    if (id === this.island) return
    this.island = id
    if (island) this.islandAdd('ground', island.mesh)
    else this.drop('island-ground')
  }

  oceanAdd(id: string, position: BABYLON.Vector3, half: number) {
    this.send(`ocean-${id}`, [[position.x, position.y - 0.5, position.z, half, 0.5, half, 0, 0, 0, 1]])
  }

  oceanDrop(id: string) {
    this.drop(`ocean-${id}`)
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
      socket.send(JSON.stringify({ type: 'hello', robot: this.kind, model: this.g1Model, origin: this.origin.asArray(), floor: this.floor }))
      for (const [id, boxes] of this.colliders) socket.send(JSON.stringify({ type: 'collider', id, boxes }))
    }
    socket.onmessage = (event) => {
      const pose = JSON.parse(event.data)
      if (pose.type === 'pose') {
        this.pose = pose
        if (pose.depth) this.drawDepth(pose.depth, pose.depthSize || [32, 18])
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
    if (this.kind === 'g1' && !event.repeat && (event.code === 'ShiftLeft' || event.code === 'ShiftRight')) {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.held.add(event.code)
      this.setModel('parkour')
      return
    }
    if (!event.repeat && event.code === 'KeyB') {
      event.preventDefault()
      event.stopImmediatePropagation()
      const query = new URLSearchParams(location.search)
      query.set('robot', this.kind === 'g1' ? 'duck' : this.kind === 'duck' ? 'toddler' : 'g1')
      location.search = query.toString()
      return
    }
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
    if (this.kind === 'duck' && !event.repeat && event.code === 'KeyX') {
      event.preventDefault()
      event.stopImmediatePropagation()
      this.auto = false
      this.marker.setEnabled(false)
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'roulade' }))
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

  private keyUp(event: KeyboardEvent) {
    this.held.delete(event.code)
    if (this.kind !== 'g1' || (event.code !== 'ShiftLeft' && event.code !== 'ShiftRight')) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!this.held.has('ShiftLeft') && !this.held.has('ShiftRight')) this.setModel('vanilla')
  }

  private setModel(model: G1Model) {
    if (this.g1Model === model) return
    this.g1Model = model
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'model', model }))
    console.info(`g1 model: ${model}`)
  }

  private sendInput() {
    if (this.socket?.readyState !== WebSocket.OPEN || performance.now() - this.sentAt < 50) return
    const forward = Number(this.held.has('KeyW') || this.held.has('ArrowUp')) - Number(this.held.has('KeyS') || this.held.has('ArrowDown'))
    const side = this.kind === 'duck' ? 0 : Number(this.held.has('KeyQ')) - Number(this.held.has('KeyE'))
    const turn = Number(this.held.has('KeyA') || this.held.has('ArrowLeft')) - Number(this.held.has('KeyD') || this.held.has('ArrowRight'))
    const walking = forward !== 0 || side !== 0 || turn !== 0
    const moving = walking || this.jump
    if (moving) {
      this.auto = false
      this.marker.setEnabled(false)
    }
    if (this.auto) return
    const flying = (this.controls as any).flying as boolean
    const lift = flying ? Number(this.held.has('Space') || this.held.has('PageUp')) - Number(this.held.has('KeyV') || this.held.has('PageDown')) : 0
    const move = this.kind === 'duck' ? [forward, turn, 0] : [forward, side * 0.5, turn]
    this.socket.send(JSON.stringify({ type: 'command', move, jump: this.jump, fly: flying, lift }))
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
    const height = this.kind === 'duck' ? Math.max(this.pose.root[2] - 1, 0) : this.pose.root[2] - (this.kind === 'toddler' ? 0.620106 : 0.8)
    body.position.set(this.origin.x - this.pose.root[0], this.origin.y + height, this.origin.z - this.pose.root[1])
    this.islandStep(body.position)
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
    const firstPerson = (this.controls as any).firstPersonView
    this.depthCanvas.hidden = this.kind !== 'g1' || this.g1Model === 'vanilla' || !firstPerson
    if (firstPerson) camera.position.copyFrom(this.headPoint())
    else camera.position.y -= this.info.cameraOffset
    for (const mesh of this.headMeshes) mesh.setEnabled(!firstPerson)
  }

  private async makeRobot() {
    const loaded = await BABYLON.SceneLoader.ImportMeshAsync(null, '/models/', this.info.file, this.scene)
    for (const mesh of loaded.meshes) mesh.isPickable = false
    this.robotRoot = loaded.meshes.find((mesh) => mesh.name === '__root__')!
    this.robotRoot.position.set(this.origin.x, this.floor, this.origin.z)
    const nodes = (loaded as any).transformNodes as BABYLON.TransformNode[]
    this.robot = this.info.bodies.map((name) => nodes.find((node) => node.name === `${this.info.prefix}:${name}`)!)
    if (this.info.scale !== 1) {
      for (const node of this.robot) {
        node.setParent(this.robotRoot)
        node.scaling.setAll(this.info.scale)
      }
    }
    this.headMeshes = this.robot[this.info.head].getChildMeshes()
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
    this.offset.set(...this.info.headOffset)
    BABYLON.Vector3.TransformCoordinatesToRef(this.offset, this.robot[this.info.head].computeWorldMatrix(true), this.head)
    return this.head
  }

  private drawDepth(depth: string, size: number[]) {
    if (this.depthCanvas.width !== size[0] || this.depthCanvas.height !== size[1]) {
      this.depthCanvas.width = size[0]
      this.depthCanvas.height = size[1]
      this.depthImage = this.depthCanvas.getContext('2d')!.createImageData(size[0], size[1])
    }
    const bytes = atob(depth)
    const pixels = this.depthImage.data
    for (let i = 0; i < bytes.length; i++) {
      const value = bytes.charCodeAt(i)
      pixels[i * 4] = value
      pixels[i * 4 + 1] = value
      pixels[i * 4 + 2] = value
      pixels[i * 4 + 3] = 255
    }
    this.depthCanvas.getContext('2d')!.putImageData(this.depthImage, 0, 0)
  }
}
