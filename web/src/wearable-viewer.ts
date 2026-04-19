import { isSafari } from '../../common/helpers/detector'
import { createWearableScene } from './helpers/scenes'
import voxImport from '../../common/vox-import/sync-vox-import'

import { loadWearableVox } from './helpers/wearable-helpers'

export class WearableViewer {
  private readonly canvas: HTMLCanvasElement
  private engine: BABYLON.Engine
  private scene?: BABYLON.Scene

  private mesh?: BABYLON.Mesh

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
  }

  resizeHandler = () => this.scene?.getEngine().resize()

  dispose() {
    window.removeEventListener('resize', this.resizeHandler.bind(this))
    this.scene?.dispose()
    this.scene?.getEngine().dispose()
  }

  async loadURL(url: string) {
    if (!this.canvas) {
      alert('No canvas')
      return
    }

    this.engine = new BABYLON.Engine(this.canvas)
    this.scene = new BABYLON.Scene(this.engine)
    this.scene.clearColor.set(0.6, 0.6, 0.6, 1)
    window.addEventListener('resize', () => this.engine.resize(), { passive: true })

    const camera = new BABYLON.ArcRotateCamera('wearable-camera', Math.PI / 2, Math.PI / 3, 3, new BABYLON.Vector3(0, 0, 0), this.scene!)
    camera.useAutoRotationBehavior = true
    camera.attachControl(this.canvas, true)
    camera.upperBetaLimit = Math.PI * 0.4
    camera.lowerRadiusLimit = 1
    camera.upperRadiusLimit = 10

    // Add fog
    this.scene!.fogEnabled = true
    this.scene!.fogMode = BABYLON.Scene.FOGMODE_EXP2
    this.scene!.fogColor = new BABYLON.Color3(0.6, 0.6, 0.6)
    this.scene!.fogStart = 22
    this.scene!.fogEnd = 50

    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 64, height: 64 }, this.scene!)
    const m = new BABYLON.StandardMaterial('ground', this.scene!)
    m.diffuseColor = new BABYLON.Color3(1, 1, 1)
    m.specularColor.set(0.3, 0.3, 0.3)
    m.specularPower = 1000

    const t = new BABYLON.Texture('/textures/grid.png', this.scene!)
    t.uScale = 64
    t.vScale = 64
    m.diffuseTexture = t
    ground.material = m

    const light = new BABYLON.HemisphericLight('light1', new BABYLON.Vector3(0, 1, 0), this.scene!)
    light.intensity = 0.5

    const sun = new BABYLON.SpotLight('sun', new BABYLON.Vector3(-1, -1, 1), this.scene!)
    sun.intensity = 1.0
    // sun.direction = new BABYLON.Vector3(0, -1, 0)
    sun.position = new BABYLON.Vector3(1, 5, 1)
    sun.setDirectionToTarget(new BABYLON.Vector3(0, 0, 0))
    // sun.radius = 10
    sun.angle = Math.PI / 2
    sun.exponent = 30

    this.scene!.ambientColor = new BABYLON.Color3(1, 1, 1) // full white ambient

    this.engine.runRenderLoop(() => this.scene?.render())

    const mesh = await voxImport(url, this.scene!)

    console.log(mesh)
    this.mesh = mesh
  }
}
