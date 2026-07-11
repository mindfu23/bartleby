import { describe, it, expect } from 'vitest'
import { sha1Hex } from '../sha1'

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))

describe('sha1Hex', () => {
  it('matches known test vectors', () => {
    expect(sha1Hex(new Uint8Array(0))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    expect(sha1Hex(bytes('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(sha1Hex(bytes('The quick brown fox jumps over the lazy dog'))).toBe(
      '2fd4e1c67a2d28fced849ee1bb76e7391b93eb12',
    )
  })

  it('handles the padding and multi-block boundaries correctly', () => {
    // 55 fits in one block with padding; 56 forces a second block; 64 is an
    // exact block so padding spills into a whole extra block.
    expect(sha1Hex(bytes('a'.repeat(55)))).toBe('c1c8bbdc22796e28c0e15163d20899b65621d65a')
    expect(sha1Hex(bytes('a'.repeat(56)))).toBe('c2db330f6083854c99d4b5bfb6e8f29f201be699')
    expect(sha1Hex(bytes('a'.repeat(64)))).toBe('0098ba824b5c16427bd7a1122a5a442a25ec644d')
    expect(sha1Hex(bytes('a'.repeat(65)))).toBe('11655326c708d70319be2610e8a57d9a5b959d3b')
  })
})
