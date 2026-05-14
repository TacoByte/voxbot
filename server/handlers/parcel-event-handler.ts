import { Response } from 'express'
import { isMod } from '../lib/helpers'
import VEvent from '../parcel-event'
import { VoxelsUserRequest } from '../user'

export async function createParcelEvent(req: VoxelsUserRequest, res: Response) {
  const { parcel_id, name, description, color, timezone, starts_at, expires_at, location } = req.body
  if (!req.user?.wallet) return res.status(403).json({ success: false })

  const event = new VEvent({ author: req.user.wallet, parcel_id, name, description, color, location, timezone, starts_at, expires_at })

  const { valid, message } = event.isValid()
  if (!valid) return res.json({ success: false, message })

  const response = await event.create()
  res.json({ success: response.success, parcel_event: { id: event.id }, message: (response as any).message || null })
}

export async function removeParcelEvent(req: VoxelsUserRequest, res: Response) {
  const { id } = req.body
  if (!req.user?.wallet) return res.status(403).json({ success: false })

  const event = await VEvent.loadFromId(id)
  if (!event || (!isMod(req) && req.user.wallet.toLowerCase() !== event.author?.toLowerCase())) {
    return res.status(401).json({ success: false })
  }

  const response = await event.remove()
  res.json({ success: response.success })
}

export async function updateParcelEvent(req: VoxelsUserRequest, res: Response) {
  const { id, name, description, color, timezone, starts_at, expires_at, location } = req.body
  if (!req.user?.wallet) return res.status(403).json({ success: false })

  const event = await VEvent.loadFromId(id)
  if (!event) return res.status(404).json({ success: false })

  if (!isMod(req) && req.user.wallet.toLowerCase() !== event.author?.toLowerCase()) {
    return res.status(401).json({ success: false, message: 'Only the author can edit this event.' })
  }

  Object.assign(event, { name, description, color, timezone, starts_at, expires_at, location })

  const { valid, message } = event.isValid()
  if (!valid) return res.json({ success: false, message })

  const response = await event.update()
  res.json({ success: response.success, parcel_event: { id: response.id } })
}
