/**
 * Browser Dropbox adapter (Android/web prototype). Mirrors fsio.ts / zipio.ts:
 * turns a `.scriv` in Dropbox into a path→bytes map the session opens, and
 * uploads an exported map back. Same HTTP API as the headless DG0 spike, so the
 * round-trip is already proven in Node — the only browser-specific unknown is
 * CORS, which Dropbox's API supports.
 *
 * The access token lives only in memory for the session (never persisted). This
 * is the prototype path; production uses OAuth PKCE with the same endpoints.
 */
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
export async function listScrivProjects(token: string, root: string): Promise<DropboxProject[]> {
  const entries = await listAll(token, root)
  return entries
    .filter((e) => e['.tag'] === 'folder' && String(e.name).toLowerCase().endsWith('.scriv'))
    .map((e) => ({ path: e.path_display as string, name: e.name as string }))
    .sort((a, b) => a.name.localeCompare(b.name))
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
export async function downloadProject(token: string, scrivPath: string): Promise<DownloadedProject> {
  const parent = scrivPath.slice(0, scrivPath.lastIndexOf('/'))
  const entries = (await listAll(token, scrivPath)).filter((e) => e['.tag'] === 'file')
  const files = new Map<string, Uint8Array>()
  const hashes = new Map<string, string>()
  for (const f of entries) {
    const res = await fetch(`${CONTENT}/files/download`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': apiArg({ path: f.path_display }) },
    })
    if (!res.ok) throw new DropboxError(`download ${f.name} → ${res.status}`)
    files.set(projectKey(parent, f.path_display), new Uint8Array(await res.arrayBuffer()))
    hashes.set(f.path_lower, f.content_hash)
  }
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
