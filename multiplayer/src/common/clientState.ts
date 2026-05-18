import { AvatarIdentity } from '../../../common/messages'
import { ClientUUID } from './clientUUID'

export type ClientState = {
  lastSeen: number | null
  identity: AvatarIdentity
  avatar: {
    animation: number
    position: [x: number, y: number, z: number]
    orientation: [x: number, y: number, z: number, w: number]
    lastMoved: number
    inConga?: boolean
    congaFollowsUuid?: string | null
  } | null

  /** time of last message received */
  lastActive: number
  clientUUID: ClientUUID
}
