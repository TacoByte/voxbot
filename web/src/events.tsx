import { useEffect, useState } from 'preact/hooks'
import { Event } from '../../common/messages/event'
import Head from './components/head'
import { useListControls } from './components/list-controls'
import { truncate } from './lib/string-utils'
import { Spinner } from './spinner'
import { fetchAPI, fetchOptions } from './utils'

export interface Props {
  path?: string
}

function TimeCard({ date }: { date: Date }) {
  const day = date.toLocaleDateString('en-US', { day: 'numeric' })
  const month = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).split(' ')[0]

  return (
    <div class="timecard">
      <b>{day}</b>
      <br />
      <sub>{month}</sub>
    </div>
  )
}

export default function Events(props: Props) {
  const [events, setEvents] = useState<Event[]>([])
  const [loaded, setLoaded] = useState(false)
  const [controls, controlsEl] = useListControls()

  async function doFetch() {
    setLoaded(false)
    // todo: verify events API supports sort param
    const r = await fetchAPI(`/api/events.json?sort=${controls.sort}`, fetchOptions())
    if (!r) { setLoaded(true); return }
    setEvents(r.events)
    setLoaded(true)
  }

  useEffect(() => { doFetch() }, [controls.sort])

  return (
    <section class="columns">
      <hgroup>
        <h1>Events</h1>
        <p>upcoming stuff happening in voxels</p>
      </hgroup>

      <article>
        {controlsEl}
          <table class="events">
            <thead>
              <tr>
                <th scope="col" style="width: 10%"></th>
                <th scope="col" style="width: 60%">Name</th>
                <th scope="col">Author</th>
                <th scope="col" style="width: 20%">Time, Parcel address</th>
              </tr>
            </thead>
            <tbody>
              {!loaded ? <tr><td colSpan={4}><Spinner /></td></tr> : events.slice(0, 10).map((event) => {
                const time = new Date(event.starts_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }).replace(/^0/, '').toLowerCase()

                return (
                  <>
                    <tr>
                      <td rowSpan={2} width="120">
                        <TimeCard date={new Date(event.starts_at)} />
                      </td>
                      <td>
                        <a href={`/events/${event.id}`}>{truncate(event.name)}</a>
                      </td>
                      <td>{event.author_name}</td>
                      <td>{time}, {event.parcel_name}</td>
                    </tr>
                    <tr>
                      <td colSpan={4}>
                        <small>{truncate(event.description, 80)}</small>
                      </td>
                    </tr>
                  </>
                )
              })}
            </tbody>
          </table>
      </article>
    </section>
  )
}
