import { describe, expect, it } from 'vitest'
import { mergeBoxes } from '../../common/voxels/boxes'

describe('mergeBoxes', () => {
  it('merges a solid volume exactly', () => {
    const filled = new Set<string>()
    for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) filled.add(`${x},${y},${z}`)
    expect(mergeBoxes(filled)).toEqual([0, 0, 0, 2, 2, 2])
  })

  it('keeps a stair stepped', () => {
    const filled = new Set(['0,0,0', '1,0,0', '1,1,0'])
    expect(mergeBoxes(filled)).toEqual([0, 0, 0, 2, 1, 1, 1, 1, 0, 1, 1, 1])
  })
})
