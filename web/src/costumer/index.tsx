import { Component, Fragment, createRef } from 'preact'
import TextInput from '../../src/components/inplace/text'
import Skin from './skin'
import WearableList from './wearable-list'
import { app } from '../../src/state'
import Avatar from './avatar'
import { Costume, CostumeAttachment } from '../../../common/messages/costumes'
import { debounce, isEqual, sortBy } from 'lodash'
import { Editor } from './editor'
import { PanelType } from '../../src/components/panel'
import { route } from 'preact-router'
import { pending, setupGizmos, setupScene } from './utils'
import { Wearable } from './wearable'
import { v1 as uuidv1 } from 'uuid'
import { CollectiblesData } from '../../../common/helpers/collections-helpers'
import { createHash } from 'crypto'
import { Spinner } from '../../src/spinner'
import Redirect from '../../src/components/redirect'

if (process.env.NODE_ENV === 'development') {
  // Must use require here as import statements are only allowed to exist at top-level.
  require('preact/debug')
}

const md5 = (data: string) => createHash('md5').update(data).digest('hex').toString()

const MAX_ATTACHMENTS = 12

const ContentType = 'application/json'

const fetchParams = {
  headers: { Accept: ContentType, 'Content-Type': ContentType },
  credentials: 'include',
} as const

interface Props {
  costumeId?: string
}

interface State {
  loading: boolean
  attachmentId: string | null
  costumes?: Array<Costume>
  avatarCostumeId?: number
}

export default class Costumer extends Component<Props, State> {
  private engine: BABYLON.Engine | null = null
  private scene: BABYLON.Scene | null = null
  private targetBone: string | null = null
  private gizmoManager: BABYLON.GizmoManager | null = null
  private editor = createRef()
  private canvas = createRef()

  state: State = { attachmentId: null, loading: true }

  componentDidMount() {
    if (!this.canvas.current) {
      console.error('Could not find canvas')
      return
    }

    this.engine = new BABYLON.Engine(this.canvas.current, true, { stencil: true })
    window.addEventListener('resize', () => this.engine?.resize(), { passive: true })
    this.scene = setupScene(this.canvas.current, this.engine, this.onClick)
    this.scene.autoClear = false

    this.gizmoManager = setupGizmos(this.scene, this.onDragEnd)

    const background = new BABYLON.Scene(this.engine)
    background.createDefaultCamera()

    const pp = new BABYLON.PostProcess('', 'Wobble', [], [], 0, background.activeCamera)

    this.fetch().then(() => {
      this.engine?.runRenderLoop(() => {
        background.render()
        this.scene?.render()
      })
    })
  }

  componentWillUnmount() {
    this.gizmoManager?.dispose()
    this.scene?.dispose()
    this.engine?.dispose()
    this.scene = null
    this.engine = null
  }

  componentDidUpdate(prevProps: Props) {
    if (!isEqual(this.props.costumeId, prevProps.costumeId)) {
      this.setState({ attachmentId: null })
      this.forceUpdate()
    }

    if (!this.state.attachmentId) {
      if (this.layer) {
        this.layer.removeAllMeshes()
      }

      if (this.gizmoManager) {
        this.gizmoManager.attachToMesh(null)
      }
    }
  }

  onDragEnd = async () => {
    const trunc = (x: number) => Math.round(x * 1000) / 1000
    const degrees = (x: number) => Math.round((x * 1000 * 180) / Math.PI) / 1000

    if (!this.gizmoManager?.['_attachedMesh']) {
      throw new Error("onDragEnd: Can't find mesh attached to gizmo manager")
    }

    const mesh = this.gizmoManager['_attachedMesh']
    const editor = this.editor.current

    if (!editor) {
      throw new Error("onDragEnd: Can't find current editor")
    }

    const position = mesh.position.asArray().map(trunc)
    const rotation = mesh.rotation.asArray().map(degrees)
    const scaling = mesh.scaling.asArray().map(trunc)

    await editor.setStateAsync({ position, rotation, scaling })

    const attachment = Object.assign({}, this.attachment, { position, rotation, scaling })
    await this.updateAttachment(attachment)
  }

  setSkin = async (skin: string) => {
    if (!this.costume) {
      return
    }

    if (!this.scene) {
      return
    }

    const material = this.scene.getMaterialByName(`material/costume`) as BABYLON.StandardMaterial | null

    if (!material) {
      console.error('Could not find material')
      return
    }

    const encodedData = 'data:image/svg+xml;base64,' + window.btoa(skin)
    const hash = md5(skin)
    const texture = BABYLON.Texture.LoadFromDataString(`texture/costume/${this.props.costumeId}/${hash}`, encodedData, this.scene, false, false, false)
    texture.hasAlpha = true

    if (material.diffuseTexture) {
      material.diffuseTexture.dispose()
    }

    material.diffuseTexture = texture

    // Update state / save skin
    const costume = { ...this.costume }
    costume.skin = skin

    const costumes = this.state.costumes?.map((c) => {
      if (c.id == this.costumeId) {
        return costume
      } else {
        return c
      }
    })

    this.setState({ costumes })

    await this.throttledUpdate(costume)
  }
  onClick = (mesh: BABYLON.AbstractMesh | undefined) => {
    if (!mesh) {
      this.setState({ attachmentId: null })
    }
  }
  setActive = async () => {
    const costume_id = this.props.costumeId
    if (!costume_id) {
      throw new Error("can't set active costume without a costumeId")
    }

    const body = { costume_id }

    await fetch('/api/avatar', { ...fetchParams, method: 'POST', body: JSON.stringify(body) })
      .then((response) => {
        if (!response.ok) {
          throw new Error(response.status + ' ' + response.statusText)
        }
        this.setState({ avatarCostumeId: parseInt(costume_id, 10) })
        app.showSnackbar('Costume choice saved', PanelType.Info)
      })
      .catch((err) => {
        app.showSnackbar('Could not set preferred costume, internal error', PanelType.Warning)
        console.error(err)
      })
  }

  deleteCostume = async () => {
    const answer = confirm(`Are you sure you want to delete costume #${this.props.costumeId}?`)
    if (!answer) {
      return
    }
    this.setState({ loading: true })
    fetch(`/api/costumes/${this.props.costumeId}`, { ...fetchParams, method: 'DELETE' })
      .then((response) => {
        if (!response.ok) throw new Error(response.status + ' ' + response.statusText)
        return response.json()
      })
      .then((data) => {
        if (!data.success) throw new Error('Could not delete costume')
      })
      .then(() => this.fetch())
      .then((costumeID) => {
        app.showSnackbar('Costume deleted', PanelType.Info)
        route(costumeID ? `/costumer/${costumeID}` : `/costumer/`, true)
      })
      .catch((err) => {
        app.showSnackbar('Could not delete costume, internal error', PanelType.Warning)
        throw err
      })
      .finally(() => {
        this.setState({ loading: false })
      })
  }

  createCostume = async (costume: Event | null | Partial<Costume>) => {
    if (!costume || costume instanceof Event) {
      let id = 1

      if (this.state.costumes) {
        const numbers = this.state.costumes.map((c) => parseInt(`${c.name}`.split('-')[1], 10) || 0)
        id = Math.max(...numbers) + 1

        if (!id || isNaN(id) || !isFinite(id)) {
          id = 1
        }
      }

      costume = { name: `Costume-${id}` }
    }

    const body = JSON.stringify(costume)
    const createResponse = await fetch(`/api/costumes/create`, { ...fetchParams, method: 'POST', body })
    if (!createResponse.ok) {
      app.showSnackbar('Could not create costume, please retry', PanelType.Warning)
      console.error('Error response from server when trying to create costume...')
      return
    }

    const createdCostume = await createResponse.json()

    if (!createdCostume || !createdCostume.success) {
      console.error('Could not create costume')
      app.showSnackbar('Could not create new costume, please retry', PanelType.Warning, 7500)
      return
    }
    await this.fetch()

    app.showSnackbar('Costume created', PanelType.Info)

    route(`/costumer/${createdCostume.id}`, true)
  }

  duplicateCostume = async () => {
    const costume = { ...this.costume }
    if (costume.name) {
      costume.name = costume.name.replace(/ copy/i, '') + ' copy'
    }

    const body = JSON.stringify(costume)

    this.setState({ loading: true })
    const createResponse = await fetch(`/api/costumes/create`, { ...fetchParams, method: 'POST', body })

    if (!createResponse.ok) {
      console.error('Error response from server when trying to duplicate costume...')
      app.showSnackbar('Could not duplicate costume, please retry', PanelType.Warning)
      return
    }

    const createdCostume = await createResponse.json()

    if (!createdCostume || !createdCostume.success) {
      console.error('Could not create costume')
      app.showSnackbar('Could not duplicate costume, please retry', PanelType.Warning)
      return
    }

    await this.fetch()

    app.showSnackbar('Duplicated costume', PanelType.Success)

    route(`/costumer/${createdCostume.id}`, true)
  }

  updateCostume = async (costume: Costume, blocking?: boolean) => {
    const body = JSON.stringify(costume)

    const costumes = this.state.costumes?.map((c: Costume) => {
      if (c.id == costume.id) {
        return costume
      } else {
        return c
      }
    })

    if (blocking) {
      await fetch(`/api/costumes/${costume.id}`, { ...fetchParams, method: 'PUT', body })
      await this.fetch()
    } else {
      this.setState({ costumes })
      await fetch(`/api/costumes/${costume.id}`, { ...fetchParams, method: 'PUT', body })
    }
  }

  downloadCostume = () => {
    const costume = this.costume

    if (!costume) {
      return
    }

    const text = JSON.stringify(costume, null, 2)

    const a: HTMLAnchorElement = document.createElement('a')
    a.style.display = 'hidden'
    a.href = window.URL.createObjectURL(new Blob([text], { type: ContentType }))
    a.download = (costume.name ?? costume.id) + '.json'
    a.click()
    a.remove()
  }

  onDragOver = (ev: DragEvent) => {
    this.targetBone = null

    this.bonespheres?.forEach((mesh: BABYLON.AbstractMesh) => {
      mesh.setEnabled(true)
      if (!mesh.material) {
        console.warn('no material', mesh)
        return
      }
      const mat = mesh.material as BABYLON.StandardMaterial

      mat.emissiveColor.set(1, 1, 1)
    })

    if (this.scene) {
      const info = this.scene.pick(ev.offsetX, ev.offsetY, (mesh: BABYLON.AbstractMesh) => mesh.id == 'bonesphere')

      if (info?.pickedMesh?.material) {
        const mat = info.pickedMesh.material as BABYLON.StandardMaterial

        mat.emissiveColor.set(0.3, 0, 1)

        this.targetBone = info.pickedMesh.metadata
      }
    }

    ev.preventDefault()
    if (ev.dataTransfer) {
      ev.dataTransfer.dropEffect = 'copy'
    }
  }

  onDragExit = () => {
    this.hideBoneSpheres()
  }

  onWheel = (ev: WheelEvent) => {
    ev.preventDefault()
  }

  onDrop = async () => {
    this.hideBoneSpheres()

    const wearable = this.droppedWearable()
    if (!wearable) {
      console.warn('no wearable')
      return
    }
    const bone = this.targetBone || 'Head' // this.skeleton.bones[0]

    if (!this.canAdd(wearable)) {
      app.showSnackbar('Unable to add to costume', PanelType.Warning)
      return
    }

    await this.addAttachment(wearable, bone)
  }

  onUpload = async (e: Event) => {
    const input = e.target
    if (!input || !(input instanceof HTMLInputElement)) {
      console.warn('invalid input', input)
      return
    }

    if (!input.files || input.files.length == 0) {
      console.warn('no files', input.files)
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      const r = e.target?.result ?? ''
      if (typeof r != 'string') {
        console.warn('invalid result', r)
        return
      }

      const j = JSON.parse(r) as Partial<Costume & { wallet: string }>

      delete j.wallet
      delete j.id

      if (j.attachments) {
        j.attachments.forEach((a) => a.uuid == uuidv1())
      }

      this.createCostume(j)
    }

    reader.readAsText(input.files[0])
  }

  setName = async (name: string) => {
    if (!this.costume) {
      app.showSnackbar("Can't set name on when no costume is selected", PanelType.Warning, 5000)
      return
    }
    const costume = { ...this.costume }
    costume.name = name

    await this.updateCostume(costume)
    await this.fetch()
  }

  removeAttachment = async (uuid: string) => {
    if (!this.costume) {
      app.showSnackbar("Can't remove attached wearable when no costume is selected", PanelType.Warning, 5000)
      return
    }
    const attachments: CostumeAttachment[] = this.costume?.attachments?.filter((a) => a.uuid != uuid) ?? []
    const costume = { ...this.costume, attachments }

    await this.updateCostume(costume, true)

    app.showSnackbar('Removed attachment', PanelType.Success)
  }

  throttledUpdate = debounce(async (costume) => {
    await this.updateCostume(costume)
  }, 1000)

  updateAttachment = async (attachment: CostumeAttachment) => {
    if (!this.costume) {
      app.showSnackbar("Can't update an attached wearable when no costume is selected", PanelType.Warning, 5000)
      return
    }
    const costume = { ...this.costume }

    if (costume.attachments) {
      costume.attachments.forEach((a) => {
        if (a.uuid == attachment.uuid) {
          Object.assign(a, attachment)
        }
      })
    }

    const costumes: Costume[] | undefined = this.state.costumes?.map((c: Costume) => {
      if (c.id == this.costumeId) {
        return costume
      } else {
        return c
      }
    })

    this.setState({ costumes })

    await this.throttledUpdate(costume)
  }

  private get attachment(): any {
    return this.costume?.attachments?.find((a) => a.uuid == this.state.attachmentId)
  }

  private get layer() {
    return this.scene?.getHighlightLayerByName('selected') ?? null
  }

  private get bonespheres() {
    return this.scene?.getMeshesById('bonesphere') ?? null
  }

  private get costumeId() {
    if (!this.props.costumeId) {
      return null
    }
    return parseInt(this.props.costumeId, 10)
  }

  private get costume(): Costume | null {
    if (!this.state.costumes || !this.props.costumeId) {
      return null
    }

    return this.state.costumes.find((c) => this.costumeId == c.id) ?? null
  }

  async fetch(): Promise<number | undefined> {
    if (!app.state.wallet) {
      throw new Error('No wallet')
    }

    this.setState({ loading: true })
    let avatarCostumeId: number | undefined

    const wallet = app.state.wallet.toLowerCase()
    // Don't block on this
    fetch(`/api/avatars/${wallet}.json`)
      .then(async (f) => {
        if (!f.ok) {
          throw new Error('Not a 200 OK response from api server')
        }
        const r = await f.json()
        if (!r.success) {
          throw new Error('Not a success in response from api server')
        }
        avatarCostumeId = r.avatar?.costume_id
        this.setState({ avatarCostumeId })
      })
      .catch((err) => {
        app.showSnackbar('Failed to load avatar costume', PanelType.Warning)
        this.setState({ loading: false })
        throw err
      })

    // Wait for this...
    const f = await fetch(`/api/costumes/by/${wallet}`)
    if (!f.ok) {
      this.setState({ loading: false })
      throw new Error('Could not fetch costumes')
    }

    const { costumes, success } = (await f.json()) as { costumes: Costume[]; success: boolean }

    if (!success) {
      app.showSnackbar('Failed to load costumes. Please try again', PanelType.Warning)
      this.setState({ loading: false })
      throw new Error('Could not fetch costumes')
    }
    this.setState({ costumes: costumes, loading: false })

    return avatarCostumeId
  }

  hideBoneSpheres() {
    this.bonespheres?.forEach((mesh: BABYLON.AbstractMesh) => {
      mesh.setEnabled(false)
    })
  }

  droppedWearable(): CollectiblesData | null {
    // @ts-expect-error - global abuse to support drag and drop
    return window['droppedWearable'] ?? null
  }

  canAdd(w: CollectiblesData) {
    if (!this.costume) {
      return false
    }

    if (!this.costume.attachments) {
      return true
    }

    if (this.costume.attachments.length >= MAX_ATTACHMENTS) {
      return false
    }

    return true
  }

  async addAttachment(wearable: CollectiblesData, bone: string) {
    if (!this.costume) {
      app.showSnackbar("Can't attach wearable when no costume is selected", PanelType.Warning, 5000)
      return
    }

    const voxelSize = 0.5
    const costume = { ...this.costume }

    const attachmentId = uuidv1()
    const attachment: CostumeAttachment = {
      name: wearable.name,
      wearable_id: typeof wearable.token_id == 'number' ? wearable.token_id : parseInt(wearable.token_id, 10),
      collection_address: wearable.collection_address ?? undefined,
      chain_id: wearable.chain_id,
      collection_id: typeof wearable.collection_id == 'number' ? wearable.collection_id : parseInt(wearable.collection_id, 10),
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scaling: [voxelSize, voxelSize, voxelSize],
      bone,
      uuid: attachmentId,
    }

    if (!costume.attachments) {
      costume.attachments = []
    }

    costume.attachments.push(attachment)

    this.setState({ attachmentId })
    await this.updateCostume(costume)
    app.showSnackbar('Wearable added', PanelType.Success)
  }

  private getCostumeForRender() {
    if (!this.state.costumes) return null
    return sortBy(this.state.costumes, (c) => c.id).map((c) => {
      const active = this.costumeId == c.id
      const flag = this.state.avatarCostumeId == c.id ? '👗 ' : ''
      return <option value={c.id}>{c.name || `costume#${c.id}`}</option>
    })
  }

  private getWearablesForRender() {
    return (
      this.costume?.attachments?.map((attachment) => {
        return (
          <Wearable
            key={`${this.props.costumeId}-${attachment.uuid}`}
            scene={this.scene}
            attachment={attachment}
            selected={attachment.uuid === this.state.attachmentId}
            gizmoManager={this.gizmoManager}
            updateAttachment={this.updateAttachment}
            onSelect={() => this.setState({ attachmentId: attachment.uuid })}
          />
        )
      }) ?? null
    )
  }

  private getAttachmentsForRender() {
    // @ts-expect-error global abuse todo stop passing this via window
    const skeleton: BABYLON.Skeleton | null = window['skeleton']
    const bones = skeleton?.bones.filter((b) => !RegExp(/index/i).exec(b.name))

    // sort wearables in bone Y Axis
    this.costume?.attachments?.sort((a, b) => {
      const aBone = bones?.find((n) => (n.name.split(':')[1] ?? n.name) === a.bone)
      const bBone = bones?.find((n) => (n.name.split(':')[1] ?? n.name) === b.bone)
      if (!aBone || !bBone) return 0
      const posA = -aBone?.getPosition(BABYLON.Space.WORLD).y
      const posB = -bBone?.getPosition(BABYLON.Space.WORLD).y
      return posA - posB
    })

    return this.costume?.attachments?.map((a) => {
      const name = a.name ?? `Wearable #${a.wearable_id}`
      const onClick = () => {
        this.setState({ attachmentId: this.state.attachmentId == a.uuid ? null : a.uuid })
      }
      return (
        <li key={`attached-${this.props.costumeId}-${a.uuid}`} onClick={onClick}>
          <a class={this.state.attachmentId !== a.uuid ? '' : 'active'}>{name}</a>
        </li>
      )
    })
  }

  onChange = (e: Event) => {
    let id = (e.target as HTMLSelectElement).value
    route(`/costumer/${id}`, true)
  }

  render() {
    if (!app.signedIn) {
      return <Redirect to="/account" returnTo="/costumer" />
    }

    const costumes = this.getCostumeForRender()
    const attachments = this.getAttachmentsForRender()

    const avatar = this.scene && (
      <Avatar scene={this.scene} costume={this.costume}>
        {this.getWearablesForRender()}
      </Avatar>
    )

    const skinKey = `skin-${this.props.costumeId}`

    const noCostumes = this.state.costumes && this.state.costumes.length == 0
    const worn = !this.props.costumeId ? false : this.state.avatarCostumeId == parseInt(this.props.costumeId, 10)
    const noAttachments = attachments && attachments.length == 0
    const noSkin = this.costume && !this.costume.skin
    const editorKey = `editor-${this.state.attachmentId}-${this.props.costumeId}`
    const preview = `/u/${app.wallet}/costumes/${this.props.costumeId}`

    return (
      <section class="costumer">
        <p>
          <a href="/">Home</a> &gt; Costumer
        </p>

        <h1>{this.costume?.name || 'New Costume'}</h1>

        <form class="new">
          <button onClick={pending(this.createCostume)}>New</button>
        </form>

        <form class="upload">
          <input onChange={this.onUpload} type="file" />
          <button>Upload</button>
        </form>

        <button disabled={worn} onClick={pending(this.setActive)}>
          Wear
        </button>
        <button onClick={this.downloadCostume}>Download</button>
        <button onClick={pending(this.duplicateCostume)}>Duplicate</button>
        <button onClick={pending(this.deleteCostume)}>Delete</button>
        <a class="button" href={preview}>
          Preview
        </a>

        <select value={this.costume?.id} onInput={this.onChange}>
          {costumes}
        </select>

        <figure>
          <canvas onWheel={this.onWheel} onDragOver={this.onDragOver} onDragExit={this.onDragExit} onDrop={this.onDrop} class="costumer" ref={this.canvas} />
        </figure>
        <main>
          <article>
            {this.costume && (
              <div>
                <h3>
                  <TextInput value={this.costume.name ? this.costume.name : `costume#${this.costume.id}`} onSave={this.setName} />
                </h3>
                <div class="column-header"></div>
              </div>
            )}

            <div class="viewer">
              <div id="gizmos" class={this.state.attachmentId !== null ? 'active' : 'inactive'}>
                <button disabled={this.state.attachmentId === null} id="gizmo-position">
                  Position
                </button>
                <button disabled={this.state.attachmentId === null} id="gizmo-rotation">
                  Rotation
                </button>
                <button disabled={this.state.attachmentId === null} id="gizmo-scale">
                  Scale
                </button>
              </div>

              {avatar}
            </div>

            <h3>Wearing</h3>

            <div class="column-header"></div>

            {this.state.attachmentId && <Editor ref={this.editor} key={editorKey} attachmentId={this.state.attachmentId} costume={this.costume} deleteAttachment={this.removeAttachment} updateAttachment={this.updateAttachment} />}

            {this.costume && (
              <Fragment>
                <ul class="tree">
                  <li>
                    <ul class="attachment-list">{attachments}</ul>
                  </li>
                  <li>{this.costume && <Skin key={skinKey} costume={this.costume} skin={this.costume.skin} default_color={this.costume.default_color} setSkin={this.setSkin} />}</li>
                </ul>
              </Fragment>
            )}
          </article>

          <aside>
            <div class="wearables-list">{this.costume && <WearableList />}</div>
          </aside>
        </main>
      </section>
    )
  }
}
