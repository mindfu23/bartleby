/**
 * Browser Dropbox adapter (Android/web prototype). Mirrors fsio.ts / zipio.ts:
 * turns a `.scriv` in Dropbox into a path→bytes map the session opens, and
 * uploads an exported map back. Same HTTP API as the headless DG0 spike, so the
 * round-trip is already proven in Node — the only browser-specific unknown is
 * CORS, which Dropbox's API supports.
 *
 * Credentials come from dropboxauth (OAuth PKCE + self-renewing access tokens).
 */
import { importZip } from './zipio'

const API = 'https://api.dropboxapi.com/2'
const CONTENT = 'https://content.dropboxapi.com/2'

/** The Dropbox-API-Arg header must be ASCII; escape non-ASCII as \uXXXX. */
export function apiArg(obj: unknown): string {
  return JSON.stringify(obj).replace(    /[\u0080-\uffff]/g,    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  )
}

/** Key a downloaded file relative to (and including) its `.scriv` folder, so
 *  ProjectSession.open normalizes the prefix away. */
export function projectKey(parentPath: string, fullPath: string): string {
  return fullPath.slice(parentPath.length + 1)
}

/** `/…/foo.scriv` → `/…/foo <suffix>.scriv` (sibling path with a name suffix). */
export function siblingPath(scrivPath: string, suffix: string): string {
  const slash = scrivPath.lastIndexOf('/')
  const parent = scrivPath.slice(0, slash)
  const name = scrivPath.slice(slash + 1).replace(/\.scriv$/i, '')
  return `${parent}/${name}${suffix}.scriv`
}
/**
 * Base name of a `.scriv` package path, without extension — the name the
 * package's `.scrivx` must match, or Scrivener mints a rival binder file.
 * `/ebooks/Novel-bartleby.scriv` → `Novel-bartleby`.
 */
export const packageBaseName = (p: string) =>
  p.slice(p.lastIndexOf('/') + 1).replace(/\.scriv$/i, '')

/** Non-destructive save target. */
export const bartlebyCopyPath = (p: string) => siblingPath(p, '-bartleby')
export const conflictCopyPath = (p: string) => siblingPath(p, ' (Bartleby conflict)')
export const backupCopyPath = (p: string) => siblingPath(p, ' (Bartleby backup)')

/** Do two path→content-hash maps describe the same folder state? */
export function hashesEqual(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v) return false
  return true
}

/** Upload order rank: content first, then `.scrivx`, then `docs.checksum` last —
 *  so an interrupted save never leaves a binder pointing at not-yet-uploaded docs. */
export function uploadRank(rel: string): number {
  if (rel.endsWith('docs.checksum')) return 2
  if (rel.toLowerCase().endsWith('.scrivx')) return 1
  return 0
}

export class DropboxError extends Error {}

async function rpc(token: string, path: string, body: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new DropboxError(`${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

/** Run `fn` over `items` with at most `limit` in flight. Order is preserved. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** One folder level, following pagination. Does NOT recurse. */
async function listFolder(token: string, path: string): Promise<any[]> {
  const out: any[] = []
  let r = await rpc(token, '/files/list_folder', { path, recursive: false, limit: 2000 })
  out.push(...r.entries)
  while (r.has_more) {
    r = await rpc(token, '/files/list_folder/continue', { cursor: r.cursor })
    out.push(...r.entries)
  }
  return out
}

async function listAll(token: string, root: string): Promise<any[]> {
  const out: any[] = []
  let r = await rpc(token, '/files/list_folder', { path: root, recursive: true, limit: 2000 })
  out.push(...r.entries)
  while (r.has_more) {
    r = await rpc(token, '/files/list_folder/continue', { cursor: r.cursor })
    out.push(...r.entries)
  }
  return out
}

/** Validate a token and return the account's display name. */
export async function whoami(token: string): Promise<string> {
  const res = await fetch(`${API}/users/get_current_account`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new DropboxError(`Token check → ${res.status}: ${await res.text()}`)
  const acct = await res.json()
  return acct?.name?.display_name ?? 'Dropbox user'
}

export interface DropboxProject {
  path: string
  name: string
}

/** List the `.scriv` projects under a Dropbox folder. */
/** How many folder levels below `root` to search for projects. */
const SEARCH_DEPTH = 4

/**
 * Find `.scriv` projects under `root`.
 *
 * Walks level-by-level and **never descends into a `.scriv` package** — a
 * recursive listing would enumerate every content.rtf inside every project
 * (thousands of entries, many pages) just to find folders by name. Sibling
 * folders are listed concurrently, so this is a few fast requests instead of a
 * full-tree crawl.
 */
export async function listScrivProjects(token: string, root: string): Promise<DropboxProject[]> {
  const found: DropboxProject[] = []
  let level = [root]
  for (let depth = 0; depth <= SEARCH_DEPTH && level.length > 0; depth++) {
    const batches = await mapLimit(level, 6, (p) => listFolder(token, p))
    const next: string[] = []
    for (const entries of batches) {
      for (const e of entries) {
        if (e['.tag'] !== 'folder') continue
        if (String(e.name).toLowerCase().endsWith('.scriv')) {
          found.push({ path: e.path_display as string, name: e.name as string })
        } else {
          next.push(e.path_display as string) // ordinary folder — look inside
        }
      }
    }
    level = next
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

/** Current server file→content-hash map for a project (base for conflict detection). */
export async function projectHashes(token: string, scrivPath: string): Promise<Map<string, string>> {
  const files = (await listAll(token, scrivPath)).filter((e) => e['.tag'] === 'file')
  return new Map(files.map((f) => [f.path_lower as string, f.content_hash as string]))
}

export interface DownloadedProject {
  files: Map<string, Uint8Array>
  /** path_lower → content_hash at download time, for later conflict detection. */
  hashes: Map<string, string>
}

/** Download a `.scriv` into a root-prefixed path→bytes map + its base hashes. */
async function downloadOne(token: string, path: string): Promise<Uint8Array> {
  const res = await fetch(`${CONTENT}/files/download`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': apiArg({ path }) },
  })
  if (!res.ok) throw new DropboxError(`download ${path} → ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/** The whole folder in ONE request. Capped by Dropbox at 20GB / 10,000 files. */
async function downloadFolderZip(token: string, path: string): Promise<ArrayBuffer> {
  const res = await fetch(`${CONTENT}/files/download_zip`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': apiArg({ path }) },
  })
  if (!res.ok) throw new DropboxError(`download_zip → ${res.status}: ${await res.text()}`)
  return res.arrayBuffer()
}

/**
 * Download a project.
 *
 * Fetches the package as a single zip rather than one request per file — a
 * .scriv holds a content.rtf (plus sidecars) for every document, so per-file
 * downloads meant dozens of sequential round-trips, which dominated load time
 * on mobile. The listing still runs, but only for content hashes (conflict
 * detection), which the zip can't carry.
 *
 * Falls back to parallel per-file downloads if the zip route fails or comes
 * back without a .scrivx (oversized folder, API change) — correctness first.
 * Key layout differs between the two routes, but ProjectSession.open()
 * normalizes the `.scriv/` root prefix either way.
 */
export async function downloadProject(token: string, scrivPath: string): Promise<DownloadedProject> {
  const parent = scrivPath.slice(0, scrivPath.lastIndexOf('/'))
  const entries = (await listAll(token, scrivPath)).filter((e) => e['.tag'] === 'file')
  const hashes = new Map<string, string>()
  for (const f of entries) hashes.set(f.path_lower, f.content_hash)

  try {
    const files = await importZip(await downloadFolderZip(token, scrivPath))
    const usable = [...files.keys()].some((p) => p.toLowerCase().endsWith('.scrivx'))
    if (usable) return { files, hashes }
  } catch {
    // fall through to per-file download
  }

  const files = new Map<string, Uint8Array>()
  await mapLimit(entries, 8, async (f) => {
    files.set(projectKey(parent, f.path_display), await downloadOne(token, f.path_display))
  })
  return { files, hashes }
}

async function uploadOne(token: string, path: string, bytes: Uint8Array): Promise<void> {
  const res = await fetch(`${CONTENT}/files/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': apiArg({ path, mode: 'overwrite', mute: true }),
      'Content-Type': 'application/octet-stream',
    },
    body: bytes,
  })
  if (!res.ok) throw new DropboxError(`upload ${path} → ${res.status}: ${await res.text()}`)
}

/** Upload an exported map into a fresh/copy destination (no orphan cleanup needed). */
export async function uploadProject(
  token: string,
  destScrivPath: string,
  files: Map<string, Uint8Array>,
): Promise<void> {
  for (const [rel, bytes] of files) await uploadOne(token, `${destScrivPath}/${rel}`, bytes)
}

/** Server-side copy of a whole folder (cheap backup). Auto-renames on collision. */
export async function copyFolder(token: string, from: string, to: string): Promise<void> {
  await rpc(token, '/files/copy_v2', { from_path: from, to_path: to, autorename: true })
}

/**
 * Overwrite a project in place: ordered upload (content → scrivx → docs.checksum),
 * then delete server files no longer in the export (stale caches, removed docs).
 */
export async function saveProjectInPlace(
  token: string,
  scrivPath: string,
  files: Map<string, Uint8Array>,
): Promise<void> {
  const desired = new Set([...files.keys()].map((rel) => `${scrivPath}/${rel}`.toLowerCase()))
  const serverBefore = (await listAll(token, scrivPath)).filter((e) => e['.tag'] === 'file')

  const ordered = [...files.entries()].sort(([a], [b]) => uploadRank(a) - uploadRank(b))
  for (const [rel, bytes] of ordered) await uploadOne(token, `${scrivPath}/${rel}`, bytes)

  for (const f of serverBefore) {
    if (!desired.has(f.path_lower)) await rpc(token, '/files/delete_v2', { path: f.path_display })
  }
}
