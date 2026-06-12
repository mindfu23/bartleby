/**
 * App-services layer: the stateful project session every frontend shares
 * (architecture-frontend-boundary §2). Holds the open project, dirty
 * tracking, and write orchestration. Contains no presentation and no DOM —
 * the React UI and the future Android (Capacitor) shell are both thin
 * clients over this class.
 */
import { bytesToLatin1, latin1ToBytes } from '../core/latin1'
import { buildRunMap, spliceEdits, buildNewDocumentRtf, type RunMap } from '../core/rtf'
import { computeEditSpans } from '../core/diff'
import {
  parseScrivx,
  insertBinderItem,
  updateProjectMeta,
  findNode,
  type ScrivxModel,
  type BinderNode,
} from '../core/scrivx'

export type { BinderNode }

/**
 * Cache/derived files Scrivener rebuilds on open. Stripped on export per the
 * phase0 §8 hypothesis. UNVERIFIED against real desktop Scrivener until
 * Gate 0 is run manually — see NOTES.md.
 */
const STRIP_ON_EXPORT = ['docs.checksum', 'search.indexes', 'binder.autosave', 'binder.backup']

interface DocState {
  rtf: string // latin1: 1 char == 1 byte
  map: RunMap
}

export class SessionError extends Error {}

export class ProjectSession {
  readonly projectName: string
  private files: Map<string, Uint8Array>
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

  /**
   * Produce the output project file map: caches stripped, project metadata
   * freshened. Keys are relative to the .scriv root (no root folder prefix).
   */
  exportFiles(): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>()
    const scrivx = updateProjectMeta(this.scrivxText)
    for (const [path, bytes] of this.files) {
      if (STRIP_ON_EXPORT.includes(path)) continue
      out.set(path, path === this.scrivxPath ? new TextEncoder().encode(scrivx) : bytes)
    }
    return out
  }
}
