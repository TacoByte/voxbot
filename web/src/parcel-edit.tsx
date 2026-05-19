import { useEffect, useState } from 'preact/hooks'
import { route } from 'preact-router'
import { blocks } from '../../common/content/blocks'
import { Login } from './auth/login'
import SelectUser from './components/select-user'
import { app } from './state'

type ParcelUser = { wallet: string; role: string }

interface Props {
  path?: string
  id?: string
}

export default function ParcelEdit(props: Props) {
  if (!app.signedIn) return <Login reason="edit this parcel" />

  const [parcel, setParcel] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [building, setBuilding] = useState(false)
  const [buildMaterial, setBuildMaterial] = useState(blocks[0].value)

  useEffect(() => {
    fetch(`/api/parcels/${props.id}.json`)
      .then((r) => r.json())
      .then((d) => setParcel(d.parcel))
  }, [props.id])

  function set(key: string, value: any) {
    setParcel((p: any) => ({ ...p, [key]: value }))
  }

  function setSettings(key: string, value: any) {
    setParcel((p: any) => ({ ...p, settings: { ...p.settings, [key]: value } }))
  }

  async function submit(e: Event) {
    e.preventDefault()
    setSaving(true)
    await fetch(`/grid/parcels/${props.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name: parcel.name,
        description: parcel.description,
        sandbox: !!parcel.settings?.sandbox,
        hosted_scripts: !!parcel.settings?.hosted_scripts,
        script_host_url: parcel.settings?.script_host_url,
        parcel_users: parcel.parcel_users ?? [],
      }),
    })
    setSaving(false)
    route(`/parcels/${props.id}`)
  }

  async function build(fn: string) {
    if (!confirm(`Replace current build with "${fn}"? This will destroy existing content.`)) return
    setBuilding(true)
    await fetch(`/grid/parcels/${props.id}/build?function=${fn}&material=${buildMaterial}`, {
      method: 'POST',
      credentials: 'include',
    })
    setBuilding(false)
  }

  function addCollaborator(wallet: string) {
    if (!wallet) return
    const users: ParcelUser[] = parcel.parcel_users ?? []
    if (users.find((u) => u.wallet.toLowerCase() === wallet.toLowerCase())) return
    set('parcel_users', [...users, { wallet, role: 'contributor' }])
  }

  function removeCollaborator(wallet: string) {
    set(
      'parcel_users',
      (parcel.parcel_users ?? []).filter((u: ParcelUser) => u.wallet !== wallet),
    )
  }

  function toggleRole(wallet: string) {
    set(
      'parcel_users',
      (parcel.parcel_users ?? []).map((u: ParcelUser) => (u.wallet === wallet ? { ...u, role: u.role === 'owner' ? 'contributor' : 'owner' } : u)),
    )
  }

  const isOwner = parcel && app.state.wallet && parcel.owner?.toLowerCase() === app.state.wallet?.toLowerCase()

  if (!parcel) return <p>Loading...</p>

  return (
    <section class="columns">
      <hgroup>
        <h1>
          <a href={`/parcels/${props.id}`}>{parcel.name || parcel.address}</a> / edit
        </h1>
      </hgroup>
      <article>
        <form onSubmit={submit}>
          <div class="f">
            <label>Name</label>
            <input type="text" value={parcel.name || ''} onInput={(e: any) => set('name', e.target.value)} />
          </div>
          <div class="f">
            <label>Description</label>
            <textarea rows={5} value={parcel.description || ''} onInput={(e: any) => set('description', e.target.value)} />
          </div>
          <div class="f">
            <label>
              <input type="checkbox" checked={!!parcel.settings?.sandbox} onChange={(e: any) => setSettings('sandbox', e.target.checked)} />
              Sandbox (publicly editable)
            </label>
          </div>
          <div class="f">
            <label>
              <input type="checkbox" checked={!!parcel.settings?.hosted_scripts} onChange={(e: any) => setSettings('hosted_scripts', e.target.checked)} />
              Hosted scripts (multiplayer)
            </label>
          </div>
          {parcel.settings?.hosted_scripts && (
            <div class="f">
              <label>Script host URL</label>
              <input type="text" value={parcel.settings?.script_host_url || ''} onInput={(e: any) => setSettings('script_host_url', e.target.value)} />
            </div>
          )}

          {isOwner && (
            <div>
              <h3>collaborators</h3>
              <SelectUser onSelect={addCollaborator} />
              {(parcel.parcel_users ?? []).length > 0 && (
                <ul>
                  {(parcel.parcel_users as ParcelUser[]).map((u) => (
                    <li key={u.wallet}>
                      {u.wallet.substring(0, 10)}...
                      <button type="button" onClick={() => toggleRole(u.wallet)}>
                        {u.role}
                      </button>
                      <button type="button" onClick={() => removeCollaborator(u.wallet)}>
                        remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <button type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </form>
      </article>
      <aside>
        <a href={`/parcels/${props.id}/snapshots`}>Snapshots</a>
        <br />
        <a href={`/parcels/${props.id}/versions`}>Versions</a>

        {isOwner && (
          <div>
            <h3>quick build</h3>
            <p>Replaces all content on the parcel.</p>
            <div class="f">
              <label>Material</label>
              <select onChange={(e: any) => setBuildMaterial(e.target.value)}>
                {blocks.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.name.replace(/.png/, '')}
                  </option>
                ))}
              </select>
            </div>
            <ul>
              {['Empty', 'Park', 'Outline', 'ThreeTowers', 'House', 'Pyramid', 'Scaffold'].map((fn) => (
                <li key={fn}>
                  <button type="button" disabled={building} onClick={() => build(fn)}>
                    {fn}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </section>
  )
}
