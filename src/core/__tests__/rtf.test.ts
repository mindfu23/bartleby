import { describe, it, expect } from 'vitest'
import {
  buildRunMap,
  spliceEdit,
  computeSimpleDiff,
  escapeRtf,
  cloneHeader,
  buildNewDocumentRtf,
  RtfError,
} from '../rtf'
import { SCENE1_RTF, SCENE1_TEXT } from './fixture'

describe('buildRunMap', () => {
  it('extracts the plain-text projection, skipping tables and ignorable groups', () => {
    const map = buildRunMap(SCENE1_RTF)
    expect(map.plainText).toBe(SCENE1_TEXT)
  })

  it('decodes cp1252 \\'+`'hh escapes and \\uN? escapes`, () => {
    const map = buildRunMap(SCENE1_RTF)
    expect(map.plainText).toContain('Café')
    expect(map.plainText).toContain('Müller')
  })

  it('records byte-accurate piece spans', () => {
    const map = buildRunMap(SCENE1_RTF)
    for (const p of map.pieces) {
      expect(p.start).toBeGreaterThanOrEqual(0)
      expect(p.end).toBeGreaterThan(p.start)
      if (p.literal) {
        expect(SCENE1_RTF.slice(p.start, p.end)).toBe(p.text)
      }
    }
  })

  it('handles escaped braces and backslashes as text', () => {
    const map = buildRunMap('{\\rtf1 a\\{b\\}c\\\\d}')
    expect(map.plainText).toBe('a{b}c\\d')
  })

  it('treats \\<newline> as a paragraph break (Cocoa RTF)', () => {
    const map = buildRunMap('{\\rtf1 first\\\nsecond}')
    expect(map.plainText).toBe('first\nsecond')
  })

  it('throws on unbalanced groups', () => {
    expect(() => buildRunMap('{\\rtf1 {unclosed')).toThrow(RtfError)
  })

  it('throws on \\bin binary data', () => {
    expect(() => buildRunMap('{\\rtf1 \\bin4 ABCD}')).toThrow(RtfError)
  })
})

describe('spliceEdit', () => {
  it('replaces text and leaves everything outside the span byte-identical', () => {
    const map = buildRunMap(SCENE1_RTF)
    const start = map.plainText.indexOf('world')
    const out = spliceEdit(SCENE1_RTF, map, start, start + 'world'.length, 'there')
    expect(buildRunMap(out).plainText).toBe(SCENE1_TEXT.replace('world', 'there'))
    // header (font table etc.) byte-identical
    const headerEnd = SCENE1_RTF.indexOf('Hello')
    expect(out.slice(0, headerEnd)).toBe(SCENE1_RTF.slice(0, headerEnd))
    // tail after the edit byte-identical
    expect(out.endsWith(SCENE1_RTF.slice(SCENE1_RTF.indexOf(', this is')))).toBe(true)
  })

  it('escapes non-ASCII replacement text', () => {
    const map = buildRunMap(SCENE1_RTF)
    const start = map.plainText.indexOf('Hello')
    const out = spliceEdit(SCENE1_RTF, map, start, start + 'Hello'.length, 'Héllo')
    expect(out).toContain('\\u233?')
    expect(buildRunMap(out).plainText).toBe(SCENE1_TEXT.replace('Hello', 'Héllo'))
  })

  it('handles edits spanning formatting runs and paragraph breaks', () => {
    const map = buildRunMap(SCENE1_RTF)
    const start = map.plainText.indexOf('bold')
    const end = map.plainText.indexOf('visited')
    const out = spliceEdit(SCENE1_RTF, map, start, end, 'rewritten.\nNew paragraph ')
    expect(buildRunMap(out).plainText).toBe(
      SCENE1_TEXT.slice(0, start) + 'rewritten.\nNew paragraph ' + SCENE1_TEXT.slice(end),
    )
  })

  it('supports pure insertion at the end of the document', () => {
    const map = buildRunMap(SCENE1_RTF)
    const len = map.plainText.length
    const out = spliceEdit(SCENE1_RTF, map, len, len, 'Appended sentence.')
    expect(buildRunMap(out).plainText).toBe(SCENE1_TEXT + 'Appended sentence.')
  })

  it('supports deletion', () => {
    const map = buildRunMap(SCENE1_RTF)
    const start = map.plainText.indexOf(' and Müller')
    const out = spliceEdit(SCENE1_RTF, map, start, start + ' and Müller'.length, '')
    expect(buildRunMap(out).plainText).toBe(SCENE1_TEXT.replace(' and Müller', ''))
  })
})

describe('computeSimpleDiff', () => {
  it('returns null for identical text', () => {
    expect(computeSimpleDiff('abc', 'abc')).toBeNull()
  })
  it('finds a middle replacement', () => {
    expect(computeSimpleDiff('one two three', 'one 2 three')).toEqual({
      start: 4,
      endOld: 7,
      replacement: '2',
    })
  })
  it('handles pure insertion and deletion', () => {
    const ins = computeSimpleDiff('ab', 'aXb')
    expect(ins).toEqual({ start: 1, endOld: 1, replacement: 'X' })
    const del = computeSimpleDiff('aXb', 'ab')
    expect(del).toEqual({ start: 1, endOld: 2, replacement: '' })
  })
  it('does not double-count overlapping prefix/suffix', () => {
    const d = computeSimpleDiff('aaa', 'aa')
    expect(d).not.toBeNull()
    const applied = 'aaa'.slice(0, d!.start) + d!.replacement + 'aaa'.slice(d!.endOld)
    expect(applied).toBe('aa')
  })
})

describe('escapeRtf', () => {
  it('escapes RTF specials and newlines', () => {
    expect(escapeRtf('a{b}c\\d\ne')).toBe('a\\{b\\}c\\\\d\\par e')
  })
  it('emits \\uN? for non-ASCII including signed wrap', () => {
    expect(escapeRtf('é')).toBe('\\u233?')
    expect(escapeRtf('�')).toBe(`\\u${0xfffd - 0x10000}?`)
  })
})

describe('new document creation', () => {
  it('clones the header from an existing document', () => {
    const { header } = cloneHeader(SCENE1_RTF)
    expect(header).toContain('\\fonttbl')
    expect(header).not.toContain('Hello')
  })
  it('builds a parseable new document with the given text', () => {
    const rtf = buildNewDocumentRtf(SCENE1_RTF, 'First line.\nSecond: café.')
    expect(buildRunMap(rtf).plainText).toBe('First line.\nSecond: café.')
  })
})
