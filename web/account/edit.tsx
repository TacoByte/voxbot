import { useEffect, useRef, useState } from 'preact/hooks'
import { ApiAvatar } from '../../common/messages/api-avatars'
import cachedFetch from '../src/helpers/cached-fetch'
import { saveAsset, AssetType } from '../src/helpers/save-helper'
import { EditSocialLink } from '../src/components/avatar-profile/socials'
import { app } from '../src/state'
import { fetchAPI } from '../src/utils'
import { PanelType } from '../src/components/panel'

export default function EditAccount() {
  const [avatar, setAvatar] = useState<ApiAvatar | undefined>(undefined)
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [homeParcel, setHomeParcel] = useState<{ id: number; name?: string; address?: string } | null>(null)
  const [parcelOptions, setParcelOptions] = useState<{ id: number; label: string }[]>([])
  const homeRef = useRef<HTMLInputElement>(null)

  const wallet = app.state?.wallet

  useEffect(() => {
    if (!wallet) return
    fetchAPI(`/api/avatars/${wallet}.json`).then((data) => {
      setAvatar(data.avatar)
      setDescription(data.avatar?.description ?? '')
      if (data.avatar?.home_id) {
        cachedFetch(`/api/parcels/${data.avatar.home_id}.json`).then((r) => r.json()).then((d) => setHomeParcel(d.parcel ?? null))
      }
    })
  }, [wallet])

  const fetchAvatar = () => fetchAPI(`/api/avatars/${wallet}.json?cb=${Date.now()}`).then((d) => setAvatar(d.avatar))

  const saveDescription = async () => {
    if (!avatar) return
    setSaving(true)
    const r = await saveAsset(AssetType.Avatar, avatar.id, { description })
    setSaving(false)
    if (r.success) app.showSnackbar('Saved!', PanelType.Success)
    else app.showSnackbar('Could not save', PanelType.Danger)
  }

  const onHomeInput = async (e: Event) => {
    const val = (e.target as HTMLInputElement).value
    if (val.length < 2) return
    const r = await cachedFetch(`/api/parcels/search.json?q=${encodeURIComponent(val)}&limit=8`)
    const data = await r.json()
    const opts = (data.parcels ?? []).map((p: any) => ({ id: p.id, label: p.name ?? p.address ?? `#${p.id}` }))
    setParcelOptions(opts)
    const match = opts.find((o: any) => o.label === val)
    if (match) setHomeId(match.id)
  }

  const setHomeId = async (parcelId: number | null) => {
    await fetchAPI('/api/avatar', { method: 'POST', credentials: 'include', body: JSON.stringify({ home_id: parcelId }), headers: { 'Content-Type': 'application/json' } })
    if (parcelId) {
      cachedFetch(`/api/parcels/${parcelId}.json`).then((r) => r.json()).then((d) => setHomeParcel(d.parcel ?? null))
    } else {
      setHomeParcel(null)
    }
    setParcelOptions([])
    if (homeRef.current) homeRef.current.value = ''
  }

  if (!app.signedIn) return <p>Not signed in.</p>

  return (
    <section class="columns">
      <hgroup>
        <h1>Edit account</h1>
        <a href={`/avatar/${wallet}`}>Back to profile</a>
      </hgroup>

      <article>
        <div class="f">
          <label>Description</label>
          <textarea value={description} rows={5} onInput={(e: any) => setDescription(e.target.value)} />
        </div>
        <button onClick={saveDescription} disabled={saving}>{saving ? 'Saving...' : 'Save description'}</button>

        <hr />

        <div class="f">
          <label>Link 1</label>
          <EditSocialLink socialLinkNumber={1} avatar={avatar} onSave={fetchAvatar} />
        </div>
        <div class="f">
          <label>Link 2</label>
          <EditSocialLink socialLinkNumber={2} avatar={avatar} onSave={fetchAvatar} />
        </div>

        <hr />

        <div class="f">
          <label>Home parcel</label>
          <div>
            {homeParcel && (
              <p>
                <a href={`/parcels/${homeParcel.id}`}>{homeParcel.name ?? homeParcel.address ?? `#${homeParcel.id}`}</a>
                {' '}<a onClick={() => setHomeId(null)}>clear</a>
              </p>
            )}
            <input ref={homeRef} type="search" placeholder="Search parcels..." onInput={onHomeInput} />
            {parcelOptions.length > 0 && (
              <ul class="datalist">
                {parcelOptions.map((o) => (
                  <li key={o.id} onClick={() => setHomeId(o.id)}>{o.label}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </article>
    </section>
  )
}
