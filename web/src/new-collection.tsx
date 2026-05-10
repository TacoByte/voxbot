import { Component } from 'preact'
import { app } from './state'
import { fetchOptions } from './utils'

interface State {
  name: string
  description: string
  submitting: boolean
  error: string | null
}

export default class NewCollection extends Component<any, State> {
  state: State = { name: '', description: '', submitting: false, error: null }

  async submit(e: Event) {
    e.preventDefault()
    const name = this.state.name.trim()
    if (!name) return
    this.setState({ submitting: true, error: null })
    const r = await fetch('/api/collections/create', {
      ...fetchOptions(),
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: this.state.description }),
    }).then((r) => r.json())
    if (!r.success) {
      this.setState({ submitting: false, error: r.message || 'Error' })
      return
    }
    window.location.href = `/collections/${r.collection_id}`
  }

  render() {
    if (!app.signedIn) return <div />
    const { name, description, submitting, error } = this.state
    return (
      <div>
        <h3>Create a collection</h3>
        <p>Collections group wearables and assets together. Once created, you can upload items and optionally deploy a smart contract to publish it on-chain.</p>
        <form onSubmit={this.submit.bind(this)}>
          <div class="f">
            <label>Name</label>
            <input type="text" value={name} onInput={(e: any) => this.setState({ name: e.target.value })} />
          </div>
          <div class="f">
            <label>Description</label>
            <textarea value={description} onInput={(e: any) => this.setState({ description: e.target.value })} />
          </div>
          {error && <p>{error}</p>}
          <button type="submit" disabled={submitting || !name.trim()}>
            {submitting ? 'Creating...' : 'Create'}
          </button>
        </form>
      </div>
    )
  }
}
