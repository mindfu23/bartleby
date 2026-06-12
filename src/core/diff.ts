/**
 * Multi-span text diff for the save path (phase1 §2.2: diff the projection,
 * never raw RTF). Two-level LCS — lines first, then words within each changed
 * block — followed by char-level tightening per span. Many small spans mean
 * formatting near (but not inside) an edit keeps its original bytes.
 */

export interface EditSpan {
  start: number
  endOld: number
  replacement: string
}

/** Guard: beyond this many DP cells, keep the coarser span rather than refine. */
const LCS_CELL_LIMIT = 4_000_000

/** Split keeping the newline attached to its line, so offsets reconstruct exactly. */
function splitLines(s: string): string[] {
  const lines = s.split('\n')
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    out.push(i < lines.length - 1 ? lines[i] + '\n' : lines[i])
  }
  if (out[out.length - 1] === '') out.pop()
  return out
}

/** Split into word and whitespace tokens; concatenation reconstructs exactly. */
function splitWords(s: string): string[] {
  return s.split(/(\s+)/).filter((t) => t !== '')
}

function tokenOffsets(tokens: string[]): number[] {
  const out: number[] = [0]
  for (const t of tokens) out.push(out[out.length - 1] + t.length)
  return out
}

interface Block {
  aStart: number
  aEnd: number
  bStart: number
  bEnd: number
}

/** LCS over token arrays, emitting maximal non-matching blocks (token indices). */
function lcsBlocks(a: string[], b: string[]): Block[] {
  const n = a.length
  const m = b.length
  const dp = new Uint32Array((n + 1) * (m + 1))
  const idx = (i: number, j: number) => i * (m + 1) + j
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[idx(i, j)] =
        a[i] === b[j]
          ? dp[idx(i + 1, j + 1)] + 1
          : Math.max(dp[idx(i + 1, j)], dp[idx(i, j + 1)])
    }
  }
  const blocks: Block[] = []
  let i = 0
  let j = 0
  let aStart = -1
  let bStart = -1
  const close = (aEnd: number, bEnd: number) => {
    if (aStart >= 0) {
      blocks.push({ aStart, aEnd, bStart, bEnd })
      aStart = -1
      bStart = -1
    }
  }
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      close(i, j)
      i++
      j++
    } else {
      if (aStart < 0) {
        aStart = i
        bStart = j
      }
      if (dp[idx(i + 1, j)] >= dp[idx(i, j + 1)]) i++
      else j++
    }
  }
  if (i < n || j < m) {
    if (aStart < 0) {
      aStart = i
      bStart = j
    }
  }
  close(n, m)
  return blocks
}

/** Char-level prefix/suffix trim of a candidate span; returns null when empty. */
function tighten(
  oldText: string,
  start: number,
  endOld: number,
  replacement: string,
): EditSpan | null {
  const oldBlock = oldText.slice(start, endOld)
  let p = 0
  const maxP = Math.min(oldBlock.length, replacement.length)
  while (p < maxP && oldBlock[p] === replacement[p]) p++
  let q = 0
  const maxQ = Math.min(oldBlock.length, replacement.length) - p
  while (
    q < maxQ &&
    oldBlock[oldBlock.length - 1 - q] === replacement[replacement.length - 1 - q]
  ) {
    q++
  }
  const s = start + p
  const e = endOld - q
  const rep = replacement.slice(p, replacement.length - q)
  if (s === e && rep === '') return null
  return { start: s, endOld: e, replacement: rep }
}

/**
 * Refine one changed region [aText vs bText] with token-level LCS.
 * `aBase` is the offset of aText within the full old text.
 */
function refine(
  spans: EditSpan[],
  oldText: string,
  aBase: number,
  aText: string,
  bText: string,
  tokenize: (s: string) => string[],
  nextLevel: ((s: string) => string[]) | null,
): void {
  const aTokens = tokenize(aText)
  const bTokens = tokenize(bText)
  if ((aTokens.length + 1) * (bTokens.length + 1) > LCS_CELL_LIMIT) {
    const span = tighten(oldText, aBase, aBase + aText.length, bText)
    if (span) spans.push(span)
    return
  }
  const aOff = tokenOffsets(aTokens)
  const bOff = tokenOffsets(bTokens)
  for (const blk of lcsBlocks(aTokens, bTokens)) {
    const aBlockStart = aBase + aOff[blk.aStart]
    const aBlock = aText.slice(aOff[blk.aStart], aOff[blk.aEnd])
    const bBlock = bText.slice(bOff[blk.bStart], bOff[blk.bEnd])
    if (nextLevel) {
      refine(spans, oldText, aBlockStart, aBlock, bBlock, nextLevel, null)
    } else {
      const span = tighten(oldText, aBlockStart, aBlockStart + aBlock.length, bBlock)
      if (span) spans.push(span)
    }
  }
}

/**
 * Compute non-overlapping edit spans (ascending, in old-text coordinates)
 * that transform oldText into newText.
 */
export function computeEditSpans(oldText: string, newText: string): EditSpan[] {
  if (oldText === newText) return []

  // char-level outer trim
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
  const oldMid = oldText.slice(prefix, oldText.length - suffix)
  const newMid = newText.slice(prefix, newText.length - suffix)

  const spans: EditSpan[] = []
  refine(spans, oldText, prefix, oldMid, newMid, splitLines, splitWords)
  spans.sort((a, b) => a.start - b.start)
  return spans
}
