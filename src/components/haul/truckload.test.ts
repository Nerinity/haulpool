import { describe, expect, it } from 'vitest'
import { BOX, layoutLoad } from './TruckLoad'

const segs = [
  { label: 'C', cuFt: 120, order: 3 },
  { label: 'A', cuFt: 140, fragileCuFt: 12, order: 1 },
  { label: 'B', cuFt: 61, order: 2 },
]
describe('truck picture layout', () => {
  it('loads in pickup order from the cab: stop 1 is closest to the cab', () => {
    const { blocks } = layoutLoad(764, 611, segs)
    expect(blocks.map((b) => b.label)).toEqual(['A', 'B', 'C'])
    expect(blocks[0].x + blocks[0].w).toBe(BOX.X1)
    expect(blocks[0].x).toBeGreaterThan(blocks[1].x)
    expect(blocks[1].x).toBeGreaterThan(blocks[2].x)
  })
  it('never overlaps and stays inside the box, even when overloaded', () => {
    for (const total of [300, 611, 900, 3000]) {
      const many = Array.from({ length: 8 }, (_, i) => ({ label: `p${i}`, cuFt: total / 8, fragileCuFt: i % 2 ? 5 : 0, order: 8 - i }))
      const { blocks, over } = layoutLoad(764, 611, many)
      expect(over).toBe(total > 611)
      for (const b of blocks) {
        expect(b.x).toBeGreaterThanOrEqual(BOX.X0)
        expect(b.x + b.w).toBeLessThanOrEqual(BOX.X1 + 1e-9)
      }
      for (let i = 1; i < blocks.length; i++) expect(blocks[i].x + blocks[i].w).toBeLessThanOrEqual(blocks[i - 1].x + 1e-9)
    }
  })
  it('one block per person; fragile is the top layer of that block', () => {
    const { blocks } = layoutLoad(764, 611, segs)
    expect(blocks).toHaveLength(3)
    expect(blocks[0].fragileH).toBeGreaterThan(0)
    expect(blocks[1].fragileH).toBe(0)
  })
})
