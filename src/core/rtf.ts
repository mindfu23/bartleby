/**
 * RTF run-map: the minimal-diff technique from phase0-handoff §6.
 *
 * The original RTF bytes are the source of truth. We never parse-and-
 * reserialize. One pass over the raw bytes classifies regions and records,
 * for every text-producing token, the exact byte span it occupies plus the
 * decoded text it contributes to the plain-text projection. Edits are byte
 * splices into a copy of the original; everything untouched stays
 * byte-identical.
 *
 * The RTF string passed in must be latin1-decoded (1 char == 1 byte) so
 * string offsets are byte offsets. See latin1.ts.
 */
import { cp1252ToChar } from './cp1252'

/** One text-producing token: byte span [start, end) and the projection text it yields. */
export interface Piece {
  start: number
  end: number
  text: string
  /** true when chars map 1:1 to bytes (plain literal text), false for escapes/control words */
  literal: boolean
}

export interface RunMap {
  pieces: Piece[]
  plainText: string
}

export class RtfError extends Error {}

/** Destination groups whose contents are never renderable text. */
const SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict',
  'listtable', 'listoverridetable', 'header', 'footer',
])

function isLetter(c: string): boolean {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}
function isDigit(c: string): boolean {
  return c >= '0' && c <= '9'
}

interface ControlWord {
  word: string
  param: number | null
  /** byte offset just past the control word, its parameter, and its single delimiting space if present */
  end: number
}

/** Parse a control word starting at the backslash at `i`. Caller guarantees s[i+1] is a letter. */
function parseControlWord(s: string, i: number): ControlWord {
  let j = i + 1
  while (j < s.length && isLetter(s[j])) j++
  const word = s.slice(i + 1, j)
  let param: number | null = null
  let k = j
  if (k < s.length && (s[k] === '-' || isDigit(s[k]))) {
    let m = k
    if (s[m] === '-') m++
    while (m < s.length && isDigit(s[m])) m++
    param = parseInt(s.slice(k, m), 10)
    k = m
  }
  // a single space delimits the control word and is part of its bytes
  if (k < s.length && s[k] === ' ') k++
  return { word, param, end: k }
}

/**
 * Build the run map in one pass. Throws RtfError on structural problems
 * (unbalanced groups, \bin data we cannot safely handle).
 */
export function buildRunMap(rtf: string): RunMap {
  const pieces: Piece[] = []
  // skip-depth stack: each entry is whether that group's content is skipped
  const skipStack: boolean[] = []
  let skipped = false
  let uc = 1 // \ucN: number of fallback bytes after \uN

  // current literal accumulation
  let litStart = -1
  let litText = ''

  const flushLiteral = (endAt: number) => {
    if (litStart >= 0) {
      pieces.push({ start: litStart, end: endAt, text: litText, literal: true })
      litStart = -1
      litText = ''
    }
  }

  let i = 0
  const n = rtf.length
  while (i < n) {
    const c = rtf[i]

    if (c === '{') {
      flushLiteral(i)
      // lookahead: is this group an ignorable/skip destination?
      let groupSkipped: boolean = skipped
      if (!groupSkipped) {
        let j = i + 1
        if (rtf[j] === '\\') {
          if (rtf[j + 1] === '*') {
            groupSkipped = true
          } else if (isLetter(rtf[j + 1])) {
            const cw = parseControlWord(rtf, j)
            if (SKIP_DESTINATIONS.has(cw.word)) groupSkipped = true
          }
        }
      }
      skipStack.push(skipped)
      skipped = groupSkipped
      i++
      continue
    }

    if (c === '}') {
      flushLiteral(i)
      if (skipStack.length === 0) throw new RtfError(`Unbalanced '}' at byte ${i}`)
      skipped = skipStack.pop()!
      i++
      continue
    }

    if (c === '\\') {
      const next = rtf[i + 1]
      if (next === undefined) throw new RtfError(`Dangling '\\' at end of file`)

      if (isLetter(next)) {
        const cw = parseControlWord(rtf, i)
        flushLiteral(i)
        let resumeAt = cw.end
        if (!skipped) {
          if (cw.word === 'par' || cw.word === 'line') {
            pieces.push({ start: i, end: cw.end, text: '\n', literal: false })
          } else if (cw.word === 'tab') {
            pieces.push({ start: i, end: cw.end, text: '\t', literal: false })
          } else if (cw.word === 'uc') {
            uc = cw.param ?? 1
          } else if (cw.word === 'u' && cw.param !== null) {
            // \uN with signed 16-bit N; followed by `uc` fallback bytes to skip
            let code = cw.param
            if (code < 0) code += 65536
            let end = cw.end
            for (let f = 0; f < uc; f++) {
              if (rtf[end] === '\\' && rtf[end + 1] === "'") end += 4
              else if (end < n && rtf[end] !== '\\' && rtf[end] !== '{' && rtf[end] !== '}') end += 1
            }
            pieces.push({ start: i, end, text: String.fromCharCode(code), literal: false })
            resumeAt = end
          } else if (cw.word === 'bin') {
            throw new RtfError('\\bin binary data is not supported (phase0 scope: text-only documents)')
          }
          // all other control words produce no text; their bytes are simply not part of any piece
        }
        i = resumeAt
        continue
      }

      // control symbol: backslash + one non-letter char
      flushLiteral(i)
      if (next === "'") {
        const hex = rtf.slice(i + 2, i + 4)
        if (!skipped) {
          const byte = parseInt(hex, 16)
          if (Number.isNaN(byte)) throw new RtfError(`Bad \\'hh escape at byte ${i}`)
          pieces.push({ start: i, end: i + 4, text: cp1252ToChar(byte), literal: false })
        }
        i += 4
        continue
      }
      if (next === '\\' || next === '{' || next === '}') {
        if (!skipped) pieces.push({ start: i, end: i + 2, text: next, literal: false })
        i += 2
        continue
      }
      if (next === '\r' || next === '\n') {
        // \<CR> / \<LF> is equivalent to \par (Cocoa RTF writes these)
        let end = i + 2
        if (next === '\r' && rtf[end] === '\n') end++
        if (!skipped) pieces.push({ start: i, end, text: '\n', literal: false })
        i = end
        continue
      }
      if (next === '~') {
        if (!skipped) pieces.push({ start: i, end: i + 2, text: ' ', literal: false })
        i += 2
        continue
      }
      if (next === '-' || next === '_') {
        // optional hyphen / non-breaking hyphen: project as nothing / hyphen
        if (!skipped && next === '_') pieces.push({ start: i, end: i + 2, text: '-', literal: false })
        i += 2
        continue
      }
      // any other control symbol: no text
      i += 2
      continue
    }

    if (c === '\r' || c === '\n') {
      // raw newlines in RTF source are ignored
      flushLiteral(i)
      i++
      continue
    }

    // literal text byte
    if (!skipped) {
      if (litStart < 0) litStart = i
      litText += c
    }
    i++
  }
  flushLiteral(n)
  if (skipStack.length !== 0) throw new RtfError('Unbalanced groups at end of file')

  return { pieces, plainText: pieces.map((p) => p.text).join('') }
}

/**
 * Map a projection char position to a byte offset.
 * `side` matters at piece boundaries: 'start' returns the byte where the char
 * at `pos` begins; 'end' returns the byte just past the char at `pos - 1`.
 */
export function projToByte(map: RunMap, pos: number, side: 'start' | 'end'): number {
  let cum = 0
  for (const p of map.pieces) {
    const len = p.text.length
    if (side === 'start' && pos < cum + len) {
      return p.literal ? p.start + (pos - cum) : p.start
    }
    if (side === 'end' && pos <= cum + len && pos > cum) {
      return p.literal ? p.start + (pos - cum) : p.end
    }
    cum += len
  }
  if (map.pieces.length > 0) {
    return map.pieces[map.pieces.length - 1].end
  }
  return -1 // empty document: caller must use the end-of-document fallback
}

/** Map a raw byte offset back to a projection (plain-text) offset. */
export function byteToProj(map: RunMap, byte: number): number {
  let cum = 0
  for (const p of map.pieces) {
    if (byte < p.start) return cum
    if (byte < p.end) return p.literal ? cum + (byte - p.start) : cum
    cum += p.text.length
  }
  return cum
}

/** RTF-escape replacement text. Non-ASCII goes out as \uN? escapes. */
export function escapeRtf(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (ch === '\\' || ch === '{' || ch === '}') {
      out += '\\' + ch
    } else if (ch === '\n') {
      out += '\\par '
    } else if (ch === '\t') {
      out += '\\tab '
    } else if (ch === '\r') {
      // normalize: skip (projection never contains \r)
    } else if (code >= 0x20 && code <= 0x7e) {
      out += ch
    } else if (code <= 0xffff) {
      const signed = code > 0x7fff ? code - 0x10000 : code
      out += `\\u${signed}?`
    } else {
      // astral plane: emit surrogate pair
      const hi = 0xd800 + ((code - 0x10000) >> 10)
      const lo = 0xdc00 + ((code - 0x10000) & 0x3ff)
      out += `\\u${hi - 0x10000}?\\u${lo - 0x10000}?`
    }
  }
  return out
}

export interface ProjEdit {
  start: number
  endOld: number
  replacement: string
}

/**
 * Splice one or more non-overlapping edits (old-projection coordinates,
 * ascending) into the original RTF bytes. Applied back-to-front so earlier
 * offsets stay valid against the original run map. Returns the new RTF
 * (latin1 string). Validates the result by re-parsing.
 */
export function spliceEdits(rtf: string, map: RunMap, edits: ProjEdit[]): string {
  let out = rtf
  const ordered = [...edits].sort((a, b) => b.start - a.start)
  for (const edit of ordered) {
    out = spliceOne(out, rtf, map, edit)
  }

  // Validate: must still parse, and the projection must reflect every edit.
  let expected = map.plainText
  for (const e of ordered) {
    expected =
      expected.slice(0, e.start) +
      e.replacement.replace(/\r/g, '') +
      expected.slice(e.endOld)
  }
  const reparsed = buildRunMap(out)
  if (reparsed.plainText !== expected) {
    throw new RtfError(
      'Post-splice validation failed: projection does not match expected text',
    )
  }
  return out
}

/** Apply a single edit to `current`, resolving offsets against the ORIGINAL map. */
function spliceOne(
  current: string,
  original: string,
  map: RunMap,
  { start: projStart, endOld: projEnd, replacement }: ProjEdit,
): string {
  let byteStart: number
  let byteEnd: number

  if (map.pieces.length === 0) {
    // empty document: insert just before the final closing brace
    const lastBrace = original.lastIndexOf('}')
    if (lastBrace < 0) throw new RtfError('No closing brace in RTF')
    byteStart = byteEnd = lastBrace
  } else if (projStart === projEnd) {
    // pure insertion
    byteStart = byteEnd =
      projStart >= map.plainText.length
        ? map.pieces[map.pieces.length - 1].end
        : projToByte(map, projStart, 'start')
  } else {
    byteStart = projToByte(map, projStart, 'start')
    byteEnd = projToByte(map, projEnd, 'end')
  }

  let escaped = escapeRtf(replacement)

  // Delimiter hazard: if the bytes before the splice point end with a control
  // word that has no delimiter (e.g. `\par`), an alphanumeric continuation
  // would be absorbed into it (`\parAppended`). Emit the delimiting space —
  // it is consumed by the control word, not projected as text. Never needed
  // when the boundary sits in literal text (a space there WOULD be text).
  const followChar = escaped !== '' ? escaped[0] : (current[byteEnd] ?? '')
  if (/^[A-Za-z0-9-]/.test(followChar)) {
    const inLiteral = map.pieces.some(
      (p) => p.literal && byteStart > p.start && byteStart <= p.end,
    )
    if (
      !inLiteral &&
      /\\[A-Za-z]+(-?\d+)?$/.test(current.slice(Math.max(0, byteStart - 40), byteStart))
    ) {
      escaped = ' ' + escaped
    }
  }

  return current.slice(0, byteStart) + escaped + current.slice(byteEnd)
}

/** Single-edit convenience wrapper over spliceEdits. */
export function spliceEdit(
  rtf: string,
  map: RunMap,
  projStart: number,
  projEnd: number,
  replacement: string,
): string {
  return spliceEdits(rtf, map, [{ start: projStart, endOld: projEnd, replacement }])
}

/**
 * Minimal single-span diff between old and new text: common prefix/suffix.
 * Returns null when identical.
 */
export function computeSimpleDiff(
  oldText: string,
  newText: string,
): { start: number; endOld: number; replacement: string } | null {
  if (oldText === newText) return null
  let prefix = 0
  const maxPrefix = Math.min(oldText.length, newText.length)
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++
  let suffix = 0
  const maxSuffix = Math.min(oldText.length, newText.length) - prefix
  while (
    suffix < maxSuffix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++
  }
  return {
    start: prefix,
    endOld: oldText.length - suffix,
    replacement: newText.slice(prefix, newText.length - suffix),
  }
}

/**
 * Clone the header of an existing content.rtf (everything before its first
 * text-producing piece) for use in a brand-new document, per phase0 §7:
 * never hand-author a header when a real one can be copied.
 */
export function cloneHeader(rtf: string): { header: string; footer: string } {
  const map = buildRunMap(rtf)
  if (map.pieces.length > 0) {
    return { header: rtf.slice(0, map.pieces[0].start), footer: '}' }
  }
  const lastBrace = rtf.lastIndexOf('}')
  if (lastBrace < 0) throw new RtfError('No closing brace in RTF')
  return { header: rtf.slice(0, lastBrace), footer: rtf.slice(lastBrace) }
}

/** Build a complete content.rtf for a new document from a cloned header. */
export function buildNewDocumentRtf(templateRtf: string, text: string): string {
  const { header, footer } = cloneHeader(templateRtf)
  return header + escapeRtf(text) + footer
}
