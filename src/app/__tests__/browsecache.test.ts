import { describe, it, expect } from 'vitest'
import { timeAgo } from '../browsecache'

describe('timeAgo', () => {
  const now = 1_000_000_000_000
  const ago = (ms: number) => timeAgo(now - ms, now)

  it('reads naturally at each scale', () => {
    expect(ago(5_000)).toBe('just now')
    expect(ago(5 * 60_000)).toBe('5 min ago')
    expect(ago(3 * 3_600_000)).toBe('3 hr ago')
    expect(ago(3 * 86_400_000)).toBe('3 days ago')
  })

  it('never shows a negative age when clocks disagree', () => {
    // Device clock behind the cache timestamp (or a Dropbox-set time) must not
    // render "-3 min ago".
    expect(timeAgo(now + 60_000, now)).toBe('just now')
  })
})
