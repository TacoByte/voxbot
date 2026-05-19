import * as t from 'io-ts'

export type AvatarRefObj = { id: number; name: string; owner: string; created_at: string }
export type AvatarRef = string | AvatarRefObj

// t.any at runtime (no server response validation), but TypeScript sees AvatarRef
export const avatarRefCodec = t.any as t.Type<AvatarRef, unknown, unknown>

export const avatarName = (a: AvatarRef | null | undefined): string => {
  if (!a) return '...'
  return typeof a === 'string' ? a.substring(0, 10) + '...' : a.name || '...'
}

export const avatarSlug = (a: AvatarRef | null | undefined): string => {
  if (!a) return ''
  return typeof a === 'string' ? a : a.name || ''
}

export const avatarWallet = (a: AvatarRef | null | undefined): string => {
  if (!a) return ''
  return typeof a === 'string' ? a : a.owner
}
