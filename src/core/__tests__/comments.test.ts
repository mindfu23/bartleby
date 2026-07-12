import { describe, it, expect } from 'vitest'
import {
  parseComments,
  serializeComments,
  commentText,
  buildCommentBody,
  wrapComment,
  unwrapComment,
} from '../comments'
import { buildRunMap } from '../rtf'

const SAMPLE_XML =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Comments>\n' +
  '    <Comment ID="ABC-123" Color="0.9 0.9 0.5"><![CDATA[' +
  '{\\rtf1\\ansi\\ansicpg1252{\\fonttbl\\f0\\fswiss Helvetica;}\\f0\\fs24 \\cf0 A note here}' +
  ']]></Comment>\n</Comments>'

const DOC = '{\\rtf1\\ansi{\\fonttbl\\f0 Helvetica;}\\f0\\fs24 Hello world.}'

describe('comments core', () => {
  it('parses id, colour, and projects the body text', () => {
    const cs = parseComments(SAMPLE_XML)
    expect(cs).toHaveLength(1)
    expect(cs[0].id).toBe('ABC-123')
    expect(cs[0].color).toBe('0.9 0.9 0.5')
    expect(commentText(cs[0].bodyRtf)).toBe('A note here')
  })

  it('round-trips parse → serialize → parse', () => {
    const cs = parseComments(SAMPLE_XML)
    expect(parseComments(serializeComments(cs))).toEqual(cs)
  })

  it('wrap preserves the document projection, and unwrap is its exact inverse', () => {
    const before = buildRunMap(DOC).plainText
    const start = DOC.indexOf('world')
    const wrapped = wrapComment(DOC, start, start + 'world'.length, 'C1')
    expect(wrapped).toContain('scrivcmt://C1')
    // the wrapper hides the anchor URL but keeps the visible text identical
    expect(buildRunMap(wrapped).plainText).toBe(before)
    expect(unwrapComment(wrapped, 'C1')).toBe(DOC)
  })

  it('buildCommentBody (no template) projects to the given text', () => {
    expect(commentText(buildCommentBody(null, 'My comment'))).toBe('My comment')
  })

  it('buildCommentBody clones an existing comment header', () => {
    const template = parseComments(SAMPLE_XML)[0].bodyRtf
    expect(commentText(buildCommentBody(template, 'Reworded'))).toBe('Reworded')
  })

  it('unwrap of a missing id is a no-op', () => {
    expect(unwrapComment(DOC, 'NOPE')).toBe(DOC)
  })
})
