import { useEffect, useRef, useState } from 'preact/hooks'

const ALLOWED_DOMAINS = ['voxels.com', 'oncyber.io', 'substrata.info', 'somniumspace.com', 'hyperfy.io', 'resonite.com', 'overte.org', 'decentraland.com']

type Result = { parcel_id?: number; location_url?: string }
type Props = { value?: Result; onChange: (r: Result) => void }
type Parcel = { id: number; name: string }

function isAllowedUrl(s: string): boolean {
  try {
    const host = new URL(s).hostname.replace('www.', '')
    return ALLOWED_DOMAINS.some((d) => host === d || host.endsWith('.' + d))
  } catch {
    return false
  }
}

export default function ParcelField({ value, onChange }: Props) {
  const [text, setText] = useState('')
  const [results, setResults] = useState<Parcel[]>([])
  const timer = useRef<any>(null)

  useEffect(() => {
    if (!text || isAllowedUrl(text)) {
      setResults([])
      return
    }
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const r = await fetch(`/api/parcels/search.json?q=${encodeURIComponent(text)}&limit=8`)
      const d = await r.json()
      setResults(d.parcels || [])
    }, 300)
  }, [text])

  function onInput(e: any) {
    const v = e.target.value
    setText(v)
    if (isAllowedUrl(v)) {
      onChange({ location_url: v })
      setResults([])
    } else {
      onChange({})
    }
  }

  function pick(p: Parcel) {
    setText(p.name)
    setResults([])
    onChange({ parcel_id: p.id })
  }

  return (
    <div style="position:relative">
      <input type="text" value={text} onInput={onInput} placeholder="Search parcel name or paste a URL" />
      {results.length > 0 && (
        <ul style="position:absolute;background:var(--background-color);border:1px solid var(--muted-border-color);width:100%;margin:0;padding:0;list-style:none;z-index:10">
          {results.map((p) => (
            <li key={p.id} style="padding:0.5rem 1rem;cursor:pointer" onClick={() => pick(p)}>
              {p.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
