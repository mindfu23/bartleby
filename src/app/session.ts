/**
 * App-services layer: the stateful project session every frontend shares
 * (architecture-frontend-boundary §2). Holds the open project, dirty
 * tracking, and write orchestration. Contains no presentation and no DOM —
 * the React UI and the future Android (Capacitor) shell are both thin
 * clients over this class.
 */
import { bytesToLatin1, latin1ToBytes } from '../core/latin1'
import {
  buildRunMap,
  spliceEdits,
  buildNewDocumentRtf,
  projToByte,
  byteToProj,
  type RunMap,
} from '../core/rtf'
import { computeEditSpans } from '../core/diff'
import {
  parseScrivx,
  insertBinderItem,
  setBinderItemTitle,
  moveBinderItem,
  updateProjectMeta,
  findNode,
  newScrivenerUuid,
  type ScrivxModel,
  type BinderNode,
  type MovePosition,
} from '../core/scrivx'
import {
  parseComments,
  serializeComments,
  commentText,
  buildCommentBody,
  wrapComment,
  unwrapComment,
  commentAnchorRanges,
  DEFAULT_COMMENT_COLOR,
} from '../core/comments'

/** A comment as the UI sees it. `range` is the projection offsets of the
 *  anchored text (null if the anchor can't be located); `anchorText` is that
 *  text, for previewing/locating in the editor. */
export interface DocComment {
  id: string
  color: string
  text: string
  range: { start: number; end: number } | null
  anchorText: string
}
import { buildDocsChecksum, DOCS_CHECKSUM_PATH } from './checksum'

export type { BinderNode, MovePosition }

/**
 * A serializable snapshot of a session's full working state — enough to restore
 * it exactly (edits, renames, dirty tracking, and the pristine original for
 * backups). Structured-clone friendly (Map/Uint8Array), so it stores directly
 * in IndexedDB for crash/close recovery.
 */
export interface SessionSnapshot {
  projectName: string
  scrivxPath: string
  files: Map<string, Uint8Array>
  originalFiles: Map<string, Uint8Array>
  dirtyDocs: string[]
  binderDirty: boolean
}

/**
 * Derived caches we cannot regenerate accurately, so we strip them and let
 * Scrivener rebuild on open (phase0 §8; Gate 0 confirmed a stale/absent cache
 * opens clean — see NOTES.md). Paths are root-relative, matching in-session
 * keys. NOTE: `docs.checksum` is NOT here — it is *regenerated*, not stripped
 * (see checksum.ts), so external-change detection stays honest for sync.
 */
const STRIP_ON_EXPORT = ['Files/search.indexes', 'Files/binder.autosave', 'Files/binder.backup']

interface DocState {
  rtf: string // latin1: 1 char == 1 byte
  map: RunMap
}

export class SessionError extends Error {}

export class ProjectSession {
  readonly projectName: string
  private files: Map<string, Uint8Array>
  /** Snapshot of the project as opened, for pre-save backups. Bytes are never mutated in place. */
  private originalFiles: Map<string, Uint8Array>
  private scrivxPath: string
  private scrivxText: string
  private model: ScrivxModel
  private docs = new Map<string, DocState>()
  private dirtyDocs = new Set<string>()
  private binderDirty = false

  private constructor(
    projectName: string,
    files: Map<string, Uint8Array>,
    scrivxPath: string,
  ) {
    this.projectName = projectName
    this.files = files
    this.originalFiles = new Map(files)
    this.scrivxPath = scrivxPath
    this.scrivxText = new TextDecoder('utf-8').decode(files.get(scrivxPath)!)
    this.model = parseScrivx(this.scrivxText)
  }

  /**
   * Open a project from a path→bytes map. Paths may be prefixed with the
   * .scriv root folder name (as folder pickers and zips produce); the prefix
   * is normalized away.
   */
  static open(rawFiles: Map<string, Uint8Array>): ProjectSession {
    const files = new Map<string, Uint8Array>()
    let rootPrefix = ''
    for (const path of rawFiles.keys()) {
      const first = path.split('/')[0]
      if (first.toLowerCase().endsWith('.scriv')) {
        rootPrefix = first + '/'
        break
      }
    }
    for (const [path, bytes] of rawFiles) {
      const p = rootPrefix && path.startsWith(rootPrefix) ? path.slice(rootPrefix.length) : path
      if (p) files.set(p, bytes)
    }

    const scrivxPath = [...files.keys()].find(
      (p) => p.toLowerCase().endsWith('.scrivx') && !p.includes('/'),
    )
    if (!scrivxPath) {
      throw new SessionError(
        'No .scrivx file found at the project root. Is this a Scrivener 3 project?',
      )
    }
    const projectName = rootPrefix
      ? rootPrefix.slice(0, -1).replace(/\.scriv$/i, '')
      : scrivxPath.replace(/\.scrivx$/i, '')
    return new ProjectSession(projectName, files, scrivxPath)
  }

  binderTree(): BinderNode[] {
    return this.model.roots
  }

  isDirty(uuid?: string): boolean {
    if (uuid) return this.dirtyDocs.has(uuid)
    return this.dirtyDocs.size > 0 || this.binderDirty
  }

  hasDocFile(uuid: string): boolean {
    return this.files.has(`Files/Data/${uuid}/content.rtf`)
  }

  private docPath(uuid: string): string {
    return `Files/Data/${uuid}/content.rtf`
  }

  private loadDoc(uuid: string): DocState | null {
    const cached = this.docs.get(uuid)
    if (cached) return cached
    const bytes = this.files.get(this.docPath(uuid))
    if (!bytes) return null
    const rtf = bytesToLatin1(bytes)
    const state: DocState = { rtf, map: buildRunMap(rtf) }
    this.docs.set(uuid, state)
    return state
  }

  /** Plain-text projection of one document ('' when it has no content file yet). */
  readDoc(uuid: string): string {
    return this.loadDoc(uuid)?.map.plainText ?? ''
  }

  /**
   * Apply an arbitrary text edit: diff the old projection against the new
   * text and splice the change into the original bytes (minimal-diff rule).
   */
  applyEdit(uuid: string, newText: string): void {
    const normalized = newText.replace(/\r\n?/g, '\n')
    const state = this.loadDoc(uuid)
    if (!state) {
      // Document has no content.rtf yet (e.g. title-only binder item):
      // create one by cloning a header from an existing document.
      const template = this.findTemplateRtf()
      const rtf = buildNewDocumentRtf(template, normalized)
      this.storeDoc(uuid, rtf)
      return
    }
    const spans = computeEditSpans(state.map.plainText, normalized)
    if (spans.length === 0) return
    const newRtf = spliceEdits(state.rtf, state.map, spans)
    this.storeDoc(uuid, newRtf)
  }

  private storeDoc(uuid: string, rtf: string): void {
    this.files.set(this.docPath(uuid), latin1ToBytes(rtf))
    this.docs.set(uuid, { rtf, map: buildRunMap(rtf) })
    this.dirtyDocs.add(uuid)
  }

  // ---- Comments (Scrivener linked comments) --------------------------------

  private commentsPath(uuid: string): string {
    return `Files/Data/${uuid}/content.comments`
  }

  /** First existing comment body in the project, to clone a header from. */
  private findCommentTemplate(): string | null {
    for (const [path, bytes] of this.files) {
      if (path.endsWith('/content.comments')) {
        const entries = parseComments(bytesToLatin1(bytes))
        if (entries.length) return entries[0].bodyRtf
      }
    }
    return null
  }

  /** The comments anchored in a document (empty when it has none). */
  getComments(uuid: string): DocComment[] {
    const bytes = this.files.get(this.commentsPath(uuid))
    if (!bytes) return []
    const state = this.loadDoc(uuid)
    const anchors = state ? commentAnchorRanges(state.rtf) : new Map()
    return parseComments(bytesToLatin1(bytes)).map((c) => {
      const a = anchors.get(c.id)
      let range: { start: number; end: number } | null = null
      let anchorText = ''
      if (a && state) {
        const start = byteToProj(state.map, a.rawStart)
        const end = byteToProj(state.map, a.rawEnd)
        range = { start, end }
        anchorText = state.map.plainText.slice(start, end)
      }
      return { id: c.id, color: c.color, text: commentText(c.bodyRtf), range, anchorText }
    })
  }

  /**
   * Add a comment anchored to the projection range [projStart, projEnd) of a
   * document. Returns the new comment id.
   */
  addComment(uuid: string, projStart: number, projEnd: number, text: string): string {
    if (projEnd <= projStart) throw new SessionError('Select some text to comment on.')
    const state = this.loadDoc(uuid)
    if (!state) throw new SessionError('Cannot comment on a document with no text.')

    const rawStart = projToByte(state.map, projStart, 'start')
    const rawEnd = projToByte(state.map, projEnd, 'end')
    if (rawStart < 0 || rawEnd <= rawStart) throw new SessionError('Invalid selection.')

    const id = newScrivenerUuid()
    const newRtf = wrapComment(state.rtf, rawStart, rawEnd, id)
    // The wrapper must not change the visible text — validate by re-projecting.
    if (buildRunMap(newRtf).plainText !== state.map.plainText) {
      throw new SessionError('Could not anchor the comment there — try selecting whole words.')
    }
    this.storeDoc(uuid, newRtf)

    const path = this.commentsPath(uuid)
    const entries = this.files.has(path)
      ? parseComments(bytesToLatin1(this.files.get(path)!))
      : []
    entries.push({ id, color: DEFAULT_COMMENT_COLOR, bodyRtf: buildCommentBody(this.findCommentTemplate(), text) })
    this.files.set(path, latin1ToBytes(serializeComments(entries)))
    this.dirtyDocs.add(uuid)
    return id
  }

  /** Replace a comment's body text. */
  editComment(uuid: string, commentId: string, text: string): void {
    const path = this.commentsPath(uuid)
    const bytes = this.files.get(path)
    if (!bytes) throw new SessionError('No comments for this document.')
    const entries = parseComments(bytesToLatin1(bytes))
    const entry = entries.find((c) => c.id === commentId)
    if (!entry) throw new SessionError(`No comment ${commentId}.`)

    const map = buildRunMap(entry.bodyRtf)
    const spans = computeEditSpans(map.plainText, text.replace(/\r\n?/g, '\n'))
    if (spans.length) entry.bodyRtf = spliceEdits(entry.bodyRtf, map, spans)
    this.files.set(path, latin1ToBytes(serializeComments(entries)))
    this.dirtyDocs.add(uuid)
  }

  /** Remove a comment: unlink its anchor from the text and drop the sidecar entry. */
  deleteComment(uuid: string, commentId: string): void {
    const state = this.loadDoc(uuid)
    if (state) {
      const newRtf = unwrapComment(state.rtf, commentId)
      if (newRtf !== state.rtf) {
        if (buildRunMap(newRtf).plainText !== state.map.plainText) {
          throw new SessionError('Removing that comment would alter the document text.')
        }
        this.storeDoc(uuid, newRtf)
      }
    }
    const path = this.commentsPath(uuid)
    const bytes = this.files.get(path)
    if (bytes) {
      const entries = parseComments(bytesToLatin1(bytes)).filter((c) => c.id !== commentId)
      if (entries.length) this.files.set(path, latin1ToBytes(serializeComments(entries)))
      else this.files.delete(path)
    }
    this.dirtyDocs.add(uuid)
  }

  /** An existing content.rtf to clone a header from (never hand-author one). */
  private findTemplateRtf(): string {
    for (const [path, bytes] of this.files) {
      if (/^Files\/Data\/[^/]+\/content\.rtf$/.test(path)) {
        return bytesToLatin1(bytes)
      }
    }
    throw new SessionError(
      'Project has no existing content.rtf to clone an RTF header from.',
    )
  }

  /** Add a new text document; returns its UUID. parentUuid null = binder root. */
  addDocument(parentUuid: string | null, title: string, text: string): string {
    if (parentUuid && !findNode(this.model, parentUuid)) {
      throw new SessionError(`No binder item with UUID ${parentUuid}`)
    }
    const template = this.findTemplateRtf()
    const { xml, uuid } = insertBinderItem(this.scrivxText, this.model, parentUuid, title)
    this.scrivxText = xml
    this.model = parseScrivx(xml)
    this.binderDirty = true
    const rtf = buildNewDocumentRtf(template, text.replace(/\r\n?/g, '\n'))
    this.storeDoc(uuid, rtf)
    return uuid
  }

  /** Capture the full working state for recovery persistence. */
  serialize(): SessionSnapshot {
    const files = new Map(this.files)
    files.set(this.scrivxPath, new TextEncoder().encode(this.scrivxText))
    return {
      projectName: this.projectName,
      scrivxPath: this.scrivxPath,
      files,
      originalFiles: new Map(this.originalFiles),
      dirtyDocs: [...this.dirtyDocs],
      binderDirty: this.binderDirty,
    }
  }

  /** Restore a session from a snapshot produced by serialize(). */
  static deserialize(s: SessionSnapshot): ProjectSession {
    const session = new ProjectSession(s.projectName, new Map(s.files), s.scrivxPath)
    session.originalFiles = new Map(s.originalFiles)
    s.dirtyDocs.forEach((u) => session.dirtyDocs.add(u))
    session.binderDirty = s.binderDirty
    return session
  }

  /** Rename any binder item (document or folder). */
  renameItem(uuid: string, title: string): void {
    const node = findNode(this.model, uuid)
    if (!node) throw new SessionError(`No binder item with UUID ${uuid}`)
    this.scrivxText = setBinderItemTitle(this.scrivxText, node, title)
    this.model = parseScrivx(this.scrivxText)
    this.binderDirty = true
  }

  /** Move an item relative to `refUuid` (before/after = sibling, inside = child). */
  moveItem(uuid: string, refUuid: string, position: MovePosition): void {
    this.scrivxText = moveBinderItem(this.scrivxText, uuid, refUuid, position)
    this.model = parseScrivx(this.scrivxText)
    this.binderDirty = true
  }

  /** Move an item into the project's Trash folder — Scrivener's "delete" (recoverable). */
  moveToTrash(uuid: string): void {
    const trash = this.model.roots.find((n) => n.type === 'TrashFolder')
    if (!trash) throw new SessionError('This project has no Trash folder.')
    if (uuid === trash.uuid) throw new SessionError('Cannot trash the Trash folder.')
    this.moveItem(uuid, trash.uuid, 'inside')
  }

  /** The project exactly as it was opened, for a restorable backup zip. */
  exportOriginalFiles(): Map<string, Uint8Array> {
    return new Map(this.originalFiles)
  }

  /**
   * Minimal change-set for saving directly back into the source folder:
   * dirty documents plus the freshened .scrivx, and the cache files to
   * delete (phase0 §8 strip hypothesis). Empty when nothing is dirty.
   */
  exportDelta(): { writes: Map<string, Uint8Array>; deletes: string[] } {
    if (!this.isDirty()) return { writes: new Map(), deletes: [] }
    const writes = new Map<string, Uint8Array>()
    for (const uuid of this.dirtyDocs) {
      const path = this.docPath(uuid)
      writes.set(path, this.files.get(path)!)
    }
    writes.set(this.scrivxPath, new TextEncoder().encode(updateProjectMeta(this.scrivxText)))
    // Regenerate docs.checksum over the current (post-edit) document bytes.
    writes.set(DOCS_CHECKSUM_PATH, buildDocsChecksum(this.files))
    const deletes = STRIP_ON_EXPORT.filter((p) => this.files.has(p))
    return { writes, deletes }
  }

  /** Call after a successful direct save: clears dirty state and stripped caches. */
  markSaved(): void {
    this.dirtyDocs.clear()
    this.binderDirty = false
    for (const p of STRIP_ON_EXPORT) this.files.delete(p)
    // Keep the in-memory map consistent with what was written to disk.
    this.files.set(DOCS_CHECKSUM_PATH, buildDocsChecksum(this.files))
  }

  /**
   * Produce the output project file map: caches stripped, project metadata
   * freshened. Keys are relative to the .scriv root (no root folder prefix).
   */
  exportFiles(): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>()
    const scrivx = updateProjectMeta(this.scrivxText)
    for (const [path, bytes] of this.files) {
      if (STRIP_ON_EXPORT.includes(path) || path === DOCS_CHECKSUM_PATH) continue
      out.set(path, path === this.scrivxPath ? new TextEncoder().encode(scrivx) : bytes)
    }
    // Regenerate docs.checksum last, over the exact bytes going out.
    out.set(DOCS_CHECKSUM_PATH, buildDocsChecksum(out))
    return out
  }
}
