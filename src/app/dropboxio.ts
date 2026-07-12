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

/** Non-destructive save target: `/…/foo.scriv` → `/…/foo-bartleby.scriv`. */
export function bartlebyCopyPath(scrivPath: string): string {
  const slash = scrivPath.lastIndexOf('/')
  const parent = scrivPath.slice(0, slash)
  const name = scrivPath.slice(slash + 1).replace(/\.scriv$/i, '')
  return `${parent}/${name}-bartleby.scriv`
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

/** Download a `.scriv` into a root-prefixed path→bytes map for ProjectSession.open. */
export async function downloadProject(
  token: string,
  scrivPath: string,
): Promise<Map<string, Uint8Array>> {
  const parent = scrivPath.slice(0, scrivPath.lastIndexOf('/'))
  const files = (await listAll(token, scrivPath)).filter((e) => e['.tag'] === 'file')
  const map = new Map<string, Uint8Array>()
  for (const f of files) {
    const res = await fetch(`${CONTENT}/files/download`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': apiArg({ path: f.path_display }) },
    })
    if (!res.ok) throw new DropboxError(`download ${f.name} → ${res.status}`)
    map.set(projectKey(parent, f.path_display), new Uint8Array(await res.arrayBuffer()))
  }
  return map
}

/** Upload an exported (root-relative) file map into a Dropbox `.scriv` folder. */
export async function uploadProject(
  token: string,
  destScrivPath: string,
  files: Map<string, Uint8Array>,
): Promise<void> {
  for (const [rel, bytes] of files) {
    const res = await fetch(`${CONTENT}/files/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Dropbox-API-Arg': apiArg({ path: `${destScrivPath}/${rel}`, mode: 'overwrite', mute: true }),
        'Content-Type': 'application/octet-stream',
      },
      body: bytes,
    })
    if (!res.ok) throw new DropboxError(`upload ${rel} → ${res.status}: ${await res.text()}`)
  }
}
