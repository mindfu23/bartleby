import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname, relative } from 'node:path'
import { buildDocsChecksum, DOCS_CHECKSUM_PATH } from '../checksum'
import { ProjectSession } from '../session'
import { sha1Hex } from '../../core/sha1'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const dec = (b: Uint8Array) => new TextDecoder().decode(b)
const parse = (text: string) =>
  new Map(text.split('\n').filter(Boolean).map((l) => l.split('=') as [string, string]))

/** Read an entire .scriv directory into a root-prefixed path→bytes map. */
function readScrivTree(projDir: string): Map<string, Uint8Array> {
  const root = resolve(repoRoot, projDir)
  const files = new Map<string, Uint8Array>()
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (!e.name.startsWith('.')) {
        const key = `${projDir}/${relative(root, full)}`.replace(/\\/g, '/')
        files.set(key, new Uint8Array(readFileSync(full)))
      }
    }
  }
  walk(root)
  return files
}

describe('buildDocsChecksum', () => {
  it('reproduces a real Scrivener docs.checksum byte-for-byte (example.scriv oracle)', () => {
    // example.scriv's on-disk docs.checksum matches raw-byte SHA-1 5/5 — a clean
    // oracle proving we compute exactly what Scrivener writes (see NOTES.md).
    const dataDir = resolve(repoRoot, 'example.scriv/Files/Data')
    const scrivener = parse(readFileSync(resolve(dataDir, 'docs.checksum'), 'latin1'))

    // Build a root-relative file map from the files Scrivener checksummed.
    const files = new Map<string, Uint8Array>()
    for (const key of scrivener.keys()) {
      files.set(`Files/Data/${key}`, new Uint8Array(readFileSync(resolve(dataDir, key))))
    }

    const ours = parse(dec(buildDocsChecksum(files)))
    expect(ours).toEqual(scrivener)
  })

  it('emits the exact format: sorted, lowercase uuid, \\n-joined, no trailing newline', () => {
    const rtf = (s: string) => new TextEncoder().encode(s)
    const files = new Map<string, Uint8Array>([
      ['Files/Data/BBBB1111-0000-0000-0000-000000000000/content.rtf', rtf('b')],
      ['Files/Data/AAAA2222-0000-0000-0000-000000000000/content.rtf', rtf('a')],
      ['Files/Data/AAAA2222-0000-0000-0000-000000000000/notes.rtf', rtf('n')],
      // ignored: not a content/notes rtf
      ['Files/Data/AAAA2222-0000-0000-0000-000000000000/synopsis.txt', rtf('x')],
      ['Files/version.txt', rtf('16')],
    ])
    const text = dec(buildDocsChecksum(files))
    const lines = text.split('\n')

    expect(lines).toHaveLength(3) // 2 content + 1 notes; synopsis/version ignored
    expect(text.endsWith('\n')).toBe(false)
    // sorted, lowercased
    expect(lines).toEqual([...lines].sort())
    expect(lines[0].startsWith('aaaa2222-0000-0000-0000-000000000000/content.rtf=')).toBe(true)
    expect(lines.every((l) => /^[0-9a-f-]+\/(content|notes)\.rtf=[0-9a-f]{40}$/.test(l))).toBe(true)
  })

  it('exposes the canonical checksum path', () => {
    expect(DOCS_CHECKSUM_PATH).toBe('Files/Data/docs.checksum')
  })

  it('end-to-end: exporting real example_v1.scriv strips caches and fixes stale hashes', () => {
    const session = ProjectSession.open(readScrivTree('example_v1.scriv'))
    const out = session.exportFiles() // no edits — a null round-trip

    // Unrebuildable caches actually stripped now (paths were previously wrong).
    expect(out.has('Files/search.indexes')).toBe(false)
    expect(out.has('Files/binder.backup')).toBe(false)
    expect(out.has(DOCS_CHECKSUM_PATH)).toBe(true)

    // Every regenerated entry matches the exact bytes exported for that file.
    // Scrivener's checksum keys are lowercase while Data/ dirs are uppercase, so
    // index the exported files case-insensitively.
    const emitted = parse(dec(out.get(DOCS_CHECKSUM_PATH)!))
    expect(emitted.size).toBeGreaterThan(0)
    const byLowerKey = new Map<string, Uint8Array>()
    for (const [path, bytes] of out) {
      if (path.startsWith('Files/Data/')) byLowerKey.set(path.slice(11).toLowerCase(), bytes)
    }
    for (const [key, hash] of emitted) {
      const bytes = byLowerKey.get(key)
      expect(bytes, `no exported file for checksum entry ${key}`).toBeDefined()
      expect(hash).toBe(sha1Hex(bytes!))
    }

    // The comment doc was stale in Scrivener's own file (see NOTES.md); ours is
    // now the true current hash, i.e. the staleness is repaired.
    expect(emitted.get('447716a1-66e7-4906-8000-c3a86280288c/content.rtf')).toBe(
      '2ebc2319417dda153f2d832de88cd4233b31c8de',
    )
  })
})
