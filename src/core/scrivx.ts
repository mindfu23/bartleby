/**
 * Structure-preserving .scrivx (binder XML) handling.
 *
 * Reading: a focused tag scanner extracts the BinderItem tree with byte
 * offsets. Mutation: new BinderItems are spliced into the original XML text
 * so everything Scrivener wrote stays byte-identical — the same minimal-diff
 * philosophy as the RTF side, applied to XML.
 */

export interface BinderNode {
  uuid: string
  type: string
  title: string
  children: BinderNode[]
  /** raw <MetaData>...</MetaData> block, verbatim, for cloning into siblings */
  metaDataRaw: string | null
  /** offset just before this item's </Children> close tag, if it has one */
  childrenInsertOffset: number | null
  /** offset just before this item's </BinderItem> close tag */
  itemEndOffset: number
  /** indentation (leading whitespace on the line) of this item's open tag */
  indent: string
  /** byte span of this item's <Title> inner text; null if it has no <Title> */
  titleTextStart: number | null
  titleTextEnd: number | null
  /** offset just after this item's opening <BinderItem ...> tag */
  openTagEnd: number
  /** offset of this item's opening `<BinderItem` tag */
  blockStart: number
  /** offset just after this item's `</BinderItem>` close tag */
  blockEnd: number
}

export interface ScrivxModel {
  roots: BinderNode[]
  /** offset just before </Binder> */
  binderInsertOffset: number
  /** raw <MetaData> block from the first Type="Text" item found anywhere, for cloning */
  textItemMetaDataRaw: string | null
}

export class ScrivxError extends Error {}

const TAG_RE = /<\/?[A-Za-z][^>]*>|<!--[\s\S]*?-->|<\?[^>]*\?>/g

function attrsOf(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(tag)) !== null) out[m[1]] = m[2]
  return out
}

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
}

export function encodeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function indentAt(xml: string, tagStart: number): string {
  const lineStart = xml.lastIndexOf('\n', tagStart - 1) + 1
  const ws = xml.slice(lineStart, tagStart)
  return /^[ \t]*$/.test(ws) ? ws : ''
}

export function parseScrivx(xml: string): ScrivxModel {
  const roots: BinderNode[] = []
  const stack: BinderNode[] = []
  let binderInsertOffset = -1
  let textItemMetaDataRaw: string | null = null
  let inBinder = false

  TAG_RE.lastIndex = 0
  let m: RegExpExecArray | null
  let pendingTitleFor: BinderNode | null = null
  let titleTextStart = -1
  let metaDataStart = -1
  let metaDataOwner: BinderNode | null = null

  while ((m = TAG_RE.exec(xml)) !== null) {
    const tag = m[0]
    const start = m.index
    if (tag.startsWith('<?') || tag.startsWith('<!--')) continue

    const isClose = tag.startsWith('</')
    const selfClose = tag.endsWith('/>')
    const name = tag.replace(/^<\/?\s*/, '').replace(/[\s/>].*$/s, '')

    if (name === 'Binder') {
      if (isClose) {
        binderInsertOffset = start
        inBinder = false
      } else {
        inBinder = true
      }
      continue
    }
    if (!inBinder) continue

    if (name === 'BinderItem') {
      if (isClose) {
        const node = stack.pop()
        if (!node) throw new ScrivxError(`Unbalanced </BinderItem> at offset ${start}`)
        node.itemEndOffset = start
        node.blockEnd = start + tag.length
        continue
      }
      const attrs = attrsOf(tag)
      const node: BinderNode = {
        uuid: attrs['UUID'] ?? attrs['ID'] ?? '',
        type: attrs['Type'] ?? '',
        title: '',
        children: [],
        metaDataRaw: null,
        childrenInsertOffset: null,
        itemEndOffset: -1,
        indent: indentAt(xml, start),
        titleTextStart: null,
        titleTextEnd: null,
        openTagEnd: start + tag.length,
        blockStart: start,
        blockEnd: -1,
      }
      const parent = stack[stack.length - 1]
      if (parent) parent.children.push(node)
      else roots.push(node)
      if (!selfClose) stack.push(node)
      continue
    }

    const current = stack[stack.length - 1]
    if (!current) continue

    if (name === 'Title') {
      if (!isClose) {
        pendingTitleFor = current
        titleTextStart = start + tag.length
      } else if (pendingTitleFor === current && current.titleTextStart === null) {
        current.title = decodeXmlEntities(xml.slice(titleTextStart, start).trim())
        current.titleTextStart = titleTextStart
        current.titleTextEnd = start
        pendingTitleFor = null
      }
      continue
    }

    if (name === 'MetaData') {
      if (!isClose && !selfClose) {
        metaDataStart = start
        metaDataOwner = current
      } else if (isClose && metaDataOwner === current && metaDataStart >= 0) {
        const raw = xml.slice(metaDataStart, start + tag.length)
        if (current.metaDataRaw === null) current.metaDataRaw = raw
        if (textItemMetaDataRaw === null && current.type === 'Text') {
          textItemMetaDataRaw = raw
        }
        metaDataStart = -1
        metaDataOwner = null
      }
      continue
    }

    if (name === 'Children' && isClose) {
      if (current.childrenInsertOffset === null) current.childrenInsertOffset = start
      continue
    }
  }

  if (stack.length !== 0) throw new ScrivxError('Unbalanced BinderItem elements')
  if (binderInsertOffset < 0) throw new ScrivxError('No <Binder> element found')

  return { roots, binderInsertOffset, textItemMetaDataRaw }
}

export function findNode(model: ScrivxModel, uuid: string): BinderNode | null {
  const walk = (nodes: BinderNode[]): BinderNode | null => {
    for (const n of nodes) {
      if (n.uuid === uuid) return n
      const hit = walk(n.children)
      if (hit) return hit
    }
    return null
  }
  return walk(model.roots)
}

/** Scrivener timestamp: YYYY-MM-DD HH:MM:SS ±HHMM, local time. */
export function scrivenerTimestamp(d: Date = new Date()): string {
  const pad = (x: number, w = 2) => String(x).padStart(w, '0')
  const offMin = -d.getTimezoneOffset()
  const sign = offMin >= 0 ? '+' : '-'
  const abs = Math.abs(offMin)
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ` +
    `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
  )
}

export function newScrivenerUuid(): string {
  return crypto.randomUUID().toUpperCase()
}

export interface InsertResult {
  xml: string
  uuid: string
}

/**
 * Insert a new Type="Text" BinderItem under `parentUuid` (or at binder root
 * when null) by splicing into the original XML. MetaData is cloned verbatim
 * from an existing Text sibling when available (phase0 §7: empirical
 * structure beats the spec).
 */
export function insertBinderItem(
  xml: string,
  model: ScrivxModel,
  parentUuid: string | null,
  title: string,
  now: Date = new Date(),
): InsertResult {
  const uuid = newScrivenerUuid()
  const ts = scrivenerTimestamp(now)
  const metaData =
    model.textItemMetaDataRaw ?? '<MetaData>\n<IncludeInCompile>Yes</IncludeInCompile>\n</MetaData>'

  let insertAt: number
  let baseIndent: string
  let wrapChildren = false
  let parentEndOffset = -1

  if (parentUuid === null) {
    insertAt = model.binderInsertOffset
    baseIndent = '    '
  } else {
    const parent = findNode(model, parentUuid)
    if (!parent) throw new ScrivxError(`No binder item with UUID ${parentUuid}`)
    baseIndent = parent.indent + '    '
    if (parent.childrenInsertOffset !== null) {
      insertAt = parent.childrenInsertOffset
    } else {
      wrapChildren = true
      parentEndOffset = parent.itemEndOffset
      insertAt = parentEndOffset
    }
  }

  const ind = baseIndent
  const item =
    `${ind}<BinderItem UUID="${uuid}" Type="Text" Created="${ts}" Modified="${ts}">\n` +
    `${ind}    <Title>${encodeXmlText(title)}</Title>\n` +
    `${ind}    ${metaData}\n` +
    `${ind}</BinderItem>\n`

  let out: string
  if (wrapChildren) {
    const block = `${ind}<Children>\n` + item + `${ind}</Children>\n`
    out = xml.slice(0, insertAt) + block + xml.slice(insertAt)
  } else {
    out = xml.slice(0, insertAt) + item + xml.slice(insertAt)
  }
  return { xml: out, uuid }
}

export type MovePosition = 'before' | 'after' | 'inside'

function isSelfOrDescendant(item: BinderNode, uuid: string): boolean {
  return item.uuid === uuid || item.children.some((c) => isSelfOrDescendant(c, uuid))
}

/** Shift every line of `block` whose leading whitespace is `from` to `to` (a
 *  uniform re-indent that preserves internal nesting). Whitespace-only cosmetic. */
function shiftIndent(block: string, from: string, to: string): string {
  if (from === to) return block
  return block
    .split('\n')
    .map((line) => (line.startsWith(from) ? to + line.slice(from.length) : line))
    .join('\n')
}

/**
 * Move a binder item to a new location by cutting its whole `<BinderItem>…
 * </BinderItem>` block and re-inserting it — string splices only, everything
 * else byte-identical. `position` is relative to `refUuid`: `before`/`after` make
 * it a sibling; `inside` appends it as a child of the (folder) ref. `node`
 * offsets are taken from a fresh parse of `xml`, so callers pass raw xml.
 */
export function moveBinderItem(
  xml: string,
  itemUuid: string,
  refUuid: string,
  position: MovePosition,
): string {
  const model = parseScrivx(xml)
  const item = findNode(model, itemUuid)
  if (!item) throw new ScrivxError(`No binder item with UUID ${itemUuid}`)
  if (!findNode(model, refUuid)) throw new ScrivxError(`No binder item with UUID ${refUuid}`)
  if (isSelfOrDescendant(item, refUuid)) {
    throw new ScrivxError('Cannot move an item into itself or its own descendant')
  }

  // 1. Extract the item's whole block: from the start of its indent line through
  //    the newline after </BinderItem>.
  const start = xml.lastIndexOf('\n', item.blockStart - 1) + 1
  let end = item.blockEnd
  if (xml[end] === '\n') end += 1
  const block = xml.slice(start, end)
  const oldIndent = item.indent

  // 2. Remove it, then reparse so target offsets are correct in the shortened xml.
  const removed = xml.slice(0, start) + xml.slice(end)
  const m2 = parseScrivx(removed)
  const ref = findNode(m2, refUuid)!

  // 3. Compute the insertion point and re-indent the block to the new depth.
  let insertAt: number
  let toInsert: string
  if (position === 'inside') {
    const childIndent = ref.children.length ? ref.children[0].indent : ref.indent + '        '
    const reindented = shiftIndent(block, oldIndent, childIndent)
    if (ref.childrenInsertOffset !== null) {
      insertAt = ref.childrenInsertOffset
      toInsert = reindented
    } else {
      const chInd = ref.indent + '    '
      insertAt = ref.itemEndOffset
      toInsert = `${chInd}<Children>\n${reindented}${chInd}</Children>\n`
    }
  } else {
    toInsert = shiftIndent(block, oldIndent, ref.indent)
    if (position === 'before') {
      insertAt = removed.lastIndexOf('\n', ref.blockStart - 1) + 1
    } else {
      insertAt = ref.blockEnd
      if (removed[insertAt] === '\n') insertAt += 1
    }
  }
  return removed.slice(0, insertAt) + toInsert + removed.slice(insertAt)
}

/**
 * Rename a binder item (document or folder) by splicing its <Title> inner text
 * in the original XML — minimal-diff, everything else byte-identical. If the
 * item has no <Title> element, one is inserted just after its opening tag.
 * `node` must come from a parse of this exact `xml` (offsets must be current).
 */
export function setBinderItemTitle(xml: string, node: BinderNode, title: string): string {
  const encoded = encodeXmlText(title)
  if (node.titleTextStart !== null && node.titleTextEnd !== null) {
    return xml.slice(0, node.titleTextStart) + encoded + xml.slice(node.titleTextEnd)
  }
  const inserted = `\n${node.indent}    <Title>${encoded}</Title>`
  return xml.slice(0, node.openTagEnd) + inserted + xml.slice(node.openTagEnd)
}

/**
 * Freshen the root <ScrivenerProject> Modified timestamp and ModID, per
 * phase0 §8. Only the first matching attribute occurrences in the root tag
 * are touched.
 */
export function updateProjectMeta(xml: string, now: Date = new Date()): string {
  const rootMatch = xml.match(/<ScrivenerProject\b[^>]*>/)
  if (!rootMatch || rootMatch.index === undefined) return xml
  let tag = rootMatch[0]
  tag = tag.replace(/\bModified="[^"]*"/, `Modified="${scrivenerTimestamp(now)}"`)
  tag = tag.replace(/\bModID="[^"]*"/, `ModID="${newScrivenerUuid()}"`)
  return xml.slice(0, rootMatch.index) + tag + xml.slice(rootMatch.index + rootMatch[0].length)
}
