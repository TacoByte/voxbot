import { createClient } from 'redis'
import cache from '../cache'
import { Db } from '../pg'
import { PassportStatic } from 'passport'
import { Express } from 'express'
import { AccessToken, WebhookReceiver, RoomServiceClient } from 'livekit-server-sdk'

const success = true
const CHANNEL = 'live:updates'
const HASH = 'live:thumbnails'

export default async function LivekitController(db: Db, passport: PassportStatic, app: Express) {
  const svc = new RoomServiceClient('https://voxels-7pvk06qt.livekit.cloud', process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET)
  const receiver = new WebhookReceiver(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!)

  const emptyTimeout = 10 * 60
  const maxParticipants = 69

  // get rooms
  let rooms = await svc.listRooms()

  async function refresh() {
    rooms = await svc.listRooms()
  }

  // Redis: pub for writes/publishes, sub for receiving fan-out
  const pub = createClient({ url: process.env.REDIS_URL })
  const sub = pub.duplicate()
  await Promise.all([pub.connect(), sub.connect()])

  // SSE clients connected to this process
  const sseClients = new Set<any>()

  sub.subscribe(CHANNEL, (msg) => {
    const line = `data: ${msg}\n\n`
    sseClients.forEach((r) => {
      try {
        r.write(line)
      } catch {}
    })
  })

  // Prune entries that haven't sent a thumbnail in >12s (handles crashes)
  setInterval(async () => {
    const all = await pub.hGetAll(HASH)
    const cutoff = Date.now() - 12000
    for (const [key, val] of Object.entries(all)) {
      try {
        const entry = JSON.parse(val)
        if (entry.ts < cutoff) {
          await pub.hDel(HASH, key)
          pub.publish(CHANNEL, JSON.stringify({ type: 'remove', parcel: key }))
        }
      } catch {}
    }
  }, 10000)

  app.get('/api/rooms', (req, res) => {
    res.json({ success, rooms })
  })

  app.get('/api/rooms/:name', async (req, res) => {
    const name = req.params.name.toString()

    if (!name.match(/^[a-z0-9-]{1,32}$/)) {
      res.status(401).send({ error: 'Invalid room name' })
      return
    }

    const room = rooms.find((r) => r.name == req.param.name)

    if (!room) {
      res.status(404).send({ error: 'Room not found' })
      return
    }

    res.json({ success, room })
  })

  // passport.authenticate('jwt', { session: false }),
  app.get('/api/rooms/:name/token', cache(false), async (req, res) => {
    const wallet = req.user ? (req.user as Express.User & { wallet: string }).wallet : `anon-${Math.random().toString(36).slice(2)}`

    const name = req.params.name.toString()

    if (!name.match(/^[a-z0-9-]{1,32}$/)) {
      res.status(401).send({ error: 'Invalid room name' })
      return
    }

    let room = rooms.find((r) => r.name == req.param.name)

    if (!room) {
      const opts = {
        name,
        emptyTimeout,
        maxParticipants,
      }
      room = await svc.createRoom(opts)
      refresh()
    }

    const identity = wallet

    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity,
    })

    at.addGrant({
      roomJoin: true,
      room: name,
      canPublish: true,
      canSubscribe: true,
    })

    const token = at.toJwt()
    res.json({ success, room, token })
  })

  app.post('/api/rooms/:name/thumbnail', async (req, res) => {
    const name = req.params.name.toString()
    const { avatar, thumbnail } = req.body ?? {}

    if (thumbnail === null || thumbnail === undefined) {
      await pub.hDel(HASH, name)
      pub.publish(CHANNEL, JSON.stringify({ type: 'remove', parcel: name }))
    } else {
      const entry = { parcel: name, avatar, thumbnail, ts: Date.now() }
      await pub.hSet(HASH, name, JSON.stringify(entry))
      pub.publish(CHANNEL, JSON.stringify({ type: 'update', parcel: name, avatar, thumbnail }))
    }

    res.json({ success })
  })

  app.get('/api/live', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const all = await pub.hGetAll(HASH)
    const entries = Object.values(all)
      .map((v) => {
        try {
          return JSON.parse(v)
        } catch {
          return null
        }
      })
      .filter(Boolean)
    res.write(`data: ${JSON.stringify({ type: 'snapshot', entries })}\n\n`)

    sseClients.add(res)
    req.on('close', () => sseClients.delete(res))
  })
}
