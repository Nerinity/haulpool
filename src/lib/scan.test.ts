import { describe, expect, it } from 'vitest'
import { isImageDataUrl, parseScanReply } from './scan'

describe('photo scan parsing (AI suggests, code validates)', () => {
  it('keeps catalog items and merges duplicates', () => {
    const r = parseScanReply('Here you go: {"items":[{"key":"desk","qty":1,"confidence":"high"},{"key":"box_medium","qty":6},{"key":"box_medium","qty":2},{"key":"piano","qty":1},{"key":"tv","qty":-3}],"summary":"Dorm room"}')
    expect(r.items).toEqual([
      { key: 'desk', qty: 1, confidence: 'high', note: undefined },
      { key: 'box_medium', qty: 8, confidence: 'medium', note: undefined },
    ])
    expect(r.summary).toBe('Dorm room')
  })
  it('caps silly quantities and survives junk', () => {
    expect(parseScanReply('{"items":[{"key":"suitcase","qty":500}]}').items[0].qty).toBe(20)
    expect(parseScanReply('sorry, I cannot see').items).toEqual([])
    expect(parseScanReply('{"items": "nope"}').items).toEqual([])
  })
  it('accepts only small image data URLs', () => {
    expect(isImageDataUrl('data:image/jpeg;base64,AAAA')).toBe(true)
    expect(isImageDataUrl('https://example.com/x.jpg')).toBe(false)
    expect(isImageDataUrl('data:text/html;base64,AAAA')).toBe(false)
  })
})
