import { Component, Fragment } from 'preact'
import { getWearableGif } from '../../src/helpers/wearable-helpers'
import { app } from '../../src/state'
import { PanelType } from '../../src/components/panel'
import { CollectiblesData, fetchUsersCollectiblesData } from '../../../common/helpers/collections-helpers'
import { Spinner } from '../../src/spinner'

type WearableListState = {
  wearables: CollectiblesData[]
  loading: boolean
  query: string
}

export default class WearableList extends Component<any, WearableListState> {
  queries = 0
  state: WearableListState = {
    wearables: [],
    loading: true,
    query: '',
  }

  handleSearch = (event: any) => {
    // Add your search logic here

    this.setState({ query: event.target.value })
  }

  render() {
    const filteredWearables = this.state.wearables.filter((wearable) => {
      return wearable.name.toLowerCase().includes(this.state.query.toLowerCase())
    })

    const wearables = filteredWearables.map((wearable) => {
      const ondragstart = (e: DragEvent) => {
        e.dataTransfer?.setData('text/plain', 'boop')
        e.stopImmediatePropagation()

        if (e.target && e.target instanceof HTMLElement) {
          e.target.className = 'dragging-wearable'
        }

        // @ts-expect-error global abuse for drag drop
        window['droppedWearable'] = wearable
      }

      const ondragend = (e: DragEvent) => {
        if (e.target && e.target instanceof HTMLElement) {
          e.target.className = 'draggable-wearable'
        }
      }

      const onClick = () => {
        app.showSnackbar('Drag and drop wearables onto your avatar to attach', PanelType.Help)
      }

      return (
        <li class="draggable-wearable" key={wearable.id} onDragStart={ondragstart} onDragEnd={ondragend} onClick={onClick} draggable={true}>
          <img width={94} height={94} src={getWearableGif(wearable)} />
          <address>{wearable.name}</address>
        </li>
      )
    })

    return (
      <Fragment>
        <h3>Wearables {this.state.loading && <Spinner size={16} />}</h3>
        <input type="search" value={this.state.query} placeholder="Search wearables" onChange={this.handleSearch} />
        <div class="column-header"></div>
        <ul class="wearables-list">{wearables}</ul>
      </Fragment>
    )
  }

  async fetch() {
    if (!app.state.wallet) {
      console.error('Can not fetch Wearables. No wallet')
      return
    }
    this.setState({ loading: true })
    const wearables = await fetchUsersCollectiblesData(app.state.wallet)
    wearables.sort((w1, w2) => w1.name.localeCompare(w2.name))
    this.setState({ loading: false, wearables })
  }

  componentDidMount() {
    this.fetch().catch(console.error.bind(console))
  }
}
