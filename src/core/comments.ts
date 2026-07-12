/**
 * Scrivener 3 linked comments (see NOTES.md). Two coordinated pieces:
 *  1. a sidecar `content.comments` XML file — one <Comment ID Color> per comment,
 *     the comment body stored as its own RTF inside CDATA;
 *  2. an anchor in the document's `content.rtf`: the commented range is wrapped in
 *     `{\field{\*\fldinst{HYPERLINK "scrivcmt://<id>"}}{\fldrslt <text>}}`.
 *
 * All splices are minimal-diff string operations on latin1 strings (1 char == 1
 * byte). Session validates every content.rtf change by re-projecting.
 */
import { buildRunMap, buildNewDocumentRtf, escapeRtf } from './rtf'

export interface CommentEntry {
  id: string
  color: string
  bodyRtf: string
}

/** Scrivener's default comment colour (observed). */
export const DEFAULT_COMMENT_COLOR = '0.99913 0.954826 0.756384'

const COMMENT_RE =
  /<Comment\s+ID="([^"]+)"(?:\s+Color="([^"]*)")?[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/Comment>/g

export function parseComments(xml: string): CommentEntry[] {
  const out: CommentEntry[] = []
  COMMENT_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = COMMENT_RE.exec(xml)) !== null) {
    out.push({ id: m[1], color: m[2] ?? DEFAULT_COMMENT_COLOR, bodyRtf: m[3] })
  }
  return out
}

export function serializeComments(entries: CommentEntry[]): string {
  const body = entries
    .map((c) => `    <Comment ID="${c.id}" Color="${c.color}"><![CDATA[${c.bodyRtf}]]></Comment>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Comments>\n${body}\n</Comments>\n`
}

/** Plain-text projection of a comment's RTF body. */
export function commentText(bodyRtf: string): string {
  try {
    return buildRunMap(bodyRtf).plainText.replace(/\s+$/, '')
  } catch {
    return ''
  }
}

/** Build a comment body RTF: clone an existing comment's header when available. */
export function buildCommentBody(templateRtf: string | null, text: string): string {
  if (templateRtf) return buildNewDocumentRtf(templateRtf, text)
  return (
    '{\\rtf1\\ansi\\ansicpg1252\\cocoartf2870' +
    '{\\fonttbl\\f0\\fswiss\\fcharset0 Helvetica;}' +
    '{\\colortbl;\\red255\\green255\\blue255;}' +
    '\\pard\\tx560\\pardirnatural\\partightenfactor0' +
    '\\f0\\fs24 \\cf0 ' +
    escapeRtf(text) +
    '}'
  )
}

function commentFieldOpen(id: string): string {
  return `{\\field{\\*\\fldinst{HYPERLINK "scrivcmt://${id}"}}{\\fldrslt `
}
const COMMENT_FIELD_CLOSE = '}}'

/** Wrap the raw byte range [rawStart, rawEnd) of `rtf` in a comment field. */
export function wrapComment(rtf: string, rawStart: number, rawEnd: number, id: string): string {
  return (
    rtf.slice(0, rawStart) +
    commentFieldOpen(id) +
    rtf.slice(rawStart, rawEnd) +
    COMMENT_FIELD_CLOSE +
    rtf.slice(rawEnd)
  )
}

/** Index of the brace matching the '{' at `openIdx` (RTF-escape aware). */
function matchBrace(s: string, openIdx: number): number {
  let depth = 0
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') {
      i++ // skip the escaped char (\{ \} \\)
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * Raw byte span of each comment's anchored text (the `\fldrslt` inner content),
 * keyed by comment id. Callers map these to projection offsets via byteToProj.
 */
export function commentAnchorRanges(rtf: string): Map<string, { rawStart: number; rawEnd: number }> {
  const out = new Map<string, { rawStart: number; rawEnd: number }>()
  const re = /scrivcmt:\/\/([^"]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(rtf)) !== null) {
    const id = m[1]
    const fieldStart = rtf.lastIndexOf('{\\field', m.index)
    if (fieldStart < 0) continue
    const fieldEnd = matchBrace(rtf, fieldStart)
    if (fieldEnd < 0) continue
    const group = rtf.slice(fieldStart, fieldEnd + 1)
    const rm = group.match(/\{\\fldrslt\b/)
    if (!rm || rm.index === undefined) continue
    const closeRel = matchBrace(group, rm.index)
    if (closeRel < 0) continue
    let cs = rm.index + rm[0].length
    if (group[cs] === ' ') cs++
    out.set(id, { rawStart: fieldStart + cs, rawEnd: fieldStart + closeRel })
  }
  return out
}

/** Remove a comment's field wrapper, keeping the commented text in place. */
export function unwrapComment(rtf: string, id: string): string {
  const anchor = rtf.indexOf(`scrivcmt://${id}`)
  if (anchor < 0) return rtf
  const fieldStart = rtf.lastIndexOf('{\\field', anchor)
  if (fieldStart < 0) return rtf
  const fieldEnd = matchBrace(rtf, fieldStart)
  if (fieldEnd < 0) return rtf

  const group = rtf.slice(fieldStart, fieldEnd + 1)
  const rm = group.match(/\{\\fldrslt\b/)
  let inner = ''
  if (rm && rm.index !== undefined) {
    const closeRel = matchBrace(group, rm.index)
    if (closeRel > 0) {
      let cs = rm.index + rm[0].length
      if (group[cs] === ' ') cs++ // skip the control-word delimiter space
      inner = group.slice(cs, closeRel)
    }
  }
  return rtf.slice(0, fieldStart) + inner + rtf.slice(fieldEnd + 1)
}
