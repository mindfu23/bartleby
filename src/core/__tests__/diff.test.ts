import { describe, it, expect } from 'vitest'
import { computeEditSpans, type EditSpan } from '../diff'
import { buildRunMap, spliceEdits } from '../rtf'
import { SCENE1_RTF, SCENE1_TEXT } from './fixture'

function apply(oldText: string, spans: EditSpan[]): string {
  let out = oldText
  for (const e of [...spans].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.endOld)
  }
  return out
}

describe('computeEditSpans', () => {
  it('returns no spans for identical text', () => {
    expect(computeEditSpans('a\nb\nc', 'a\nb\nc')).toEqual([])
  })

  it('produces separate spans for edits at the start AND end of a document', () => {
    const oldText = 'first line\nmiddle stays put\nlast line\n'
    const newText = 'FIRST line\nmiddle stays put\nlast LINE\n'
    const spans = computeEditSpans(oldText, newText)
    expect(spans.length).toBe(2)
    expect(apply(oldText, spans)).toBe(newText)
    // the untouched middle line is not inside any span
    const midStart = oldText.indexOf('middle')
    const midEnd = midStart + 'middle stays put'.length
    for (const s of spans) {
      expect(s.endOld <= midStart || s.start >= midEnd).toBe(true)
    }
  })

  it('reconstructs arbitrary multi-edit changes', () => {
    const oldText = 'alpha\nbeta\ngamma\ndelta\nepsilon\n'
    const newText = 'alpha!\nbeta\ninserted\ngamma\nepsilon changed\n'
    const spans = computeEditSpans(oldText, newText)
    expect(apply(oldText, spans)).toBe(newText)
  })

  it('handles pure deletion of a middle paragraph', () => {
    const oldText = 'one\ntwo\nthree\n'
    const newText = 'one\nthree\n'
    const spans = computeEditSpans(oldText, newText)
    expect(apply(oldText, spans)).toBe(newText)
  })
})

describe('multi-span splice preserves interior formatting (smoke-test regression)', () => {
  it('keeps \\b bold\\b0 bytes when edits touch only the start and end', () => {
    const map = buildRunMap(SCENE1_RTF)
    // edit at the start ("world" -> "there") and at the end (append "again")
    const newText = SCENE1_TEXT.replace('world', 'there').replace(
      'visited.',
      'visited again.',
    )
    const spans = computeEditSpans(map.plainText, newText)
    const out = spliceEdits(SCENE1_RTF, map, spans)
    expect(buildRunMap(out).plainText).toBe(newText)
    // interior formatting bytes survived
    expect(out).toContain('\\b bold\\b0')
    expect(out).toContain('\\i italic\\i0')
    // the original cp1252 escape for é survived (not rewritten as \uN?)
    expect(out).toContain("\\'e9")
  })
})
