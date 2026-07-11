/**
 * Regenerates Scrivener's `Files/Data/docs.checksum`.
 *
 * Empirically (verified against real Scrivener-written fixtures — `example.scriv`
 * matches 5/5): the file lists one entry per document `content.rtf` and `notes.rtf`,
 * as `<lowercase-uuid>/<file>.rtf=<sha1hex>`, one per line, `\n`-joined, with **no
 * trailing newline**. The digest is a plain SHA-1 over the raw file bytes.
 *
 * `docs.checksum` drives Scrivener's external-change / sync detection, not
 * load-time integrity (a stale one still opens — Scrivener itself leaves stale
 * entries; see NOTES.md). Regenerating it correctly on export keeps that
 * detection honest, which matters for the Phase 1 Dropbox/iOS sync work.
 */
import { sha1Hex } from '../core/sha1'

/** `Files/Data/<uuid>/content.rtf` or `.../notes.rtf`, root-relative. */
const ENTRY_RE = /^Files\/Data\/([^/]+)\/(content|notes)\.rtf$/

export const DOCS_CHECKSUM_PATH = 'Files/Data/docs.checksum'

/**
 * Build the `docs.checksum` byte content for a root-relative project file map.
 * Entries are sorted for deterministic output (Scrivener does a keyed lookup,
 * so order is irrelevant to it, but determinism keeps diffs and tests stable).
 */
export function buildDocsChecksum(files: Map<string, Uint8Array>): Uint8Array {
  const lines: string[] = []
  for (const [path, bytes] of files) {
    const m = ENTRY_RE.exec(path)
    if (!m) continue
    lines.push(`${m[1].toLowerCase()}/${m[2]}.rtf=${sha1Hex(bytes)}`)
  }
  lines.sort()
  return new TextEncoder().encode(lines.join('\n'))
}
