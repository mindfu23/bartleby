/**
 * DG0 — Dropbox round-trip spike (headless). The make-or-break test for the
 * Android/Dropbox v1: prove a `.scriv` written back to Dropbox via the API
 * reopens cleanly in Mac Scrivener.
 *
 * It downloads a `.scriv` from Dropbox, runs a NULL round-trip through the exact
 * Bartleby core (`ProjectSession`), and uploads the result to a NEW path
 * (`<name>-dg0.scriv`) — the original is never touched. You then let the Dropbox
 * desktop client sync, open the `-dg0` copy in Scrivener, and confirm it opens
 * with no error/repair dialog.
 *
 * Usage:
 *   # list the .scriv projects under a folder so you can find the exact path:
 *   npm run dg0 -- "/ebooks" --token-file ~/Desktop/dg0/.env
 *
 *   # run the round-trip on one project:
 *   npm run dg0 -- "/ebooks/somebook/thebook.scriv" --token-file ~/Desktop/dg0/.env
 *
 * The token is a live credential — it stays in your local file, never committed.
 * Short-lived (~4h): regenerate in the Dropbox app console if it expires.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ProjectSession } from '../src/app/session'

const API = 'https://api.dropboxapi.com/2'
const CONTENT = 'https://content.dropboxapi.com/2'

const args = process.argv.slice(2)
const source = args.find((a) => !a.startsWith('--'))
const argVal = (flag: string) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

function loadToken(): string {
  const file = argVal('--token-file')
  if (file) {
    const raw = readFileSync(file.replace(/^~/, process.env.HOME ?? '~'), 'utf8').trim()
    const m = raw.match(/DROPBOX_TOKEN\s*=\s*(.+)/)
    return (m ? m[1] : raw).trim().replace(/^["']|["']$/g, '')
  }
  if (process.env.DROPBOX_TOKEN) return process.env.DROPBOX_TOKEN
  throw new Error('No token — set DROPBOX_TOKEN or pass --token-file <path>')
}

let _token: string | null = null
const authHeaderLazy = () => {
  if (_token === null) _token = loadToken()
  return { Authorization: `Bearer ${_token}` } as const
}

/** Read a local .scriv folder into a root-prefixed path→bytes map. */
function readLocalScriv(root: string): Map<string, Uint8Array> {
  const map = new Map<string, Uint8Array>()
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else map.set(`${root}/${relative(root, full)}`, new Uint8Array(readFileSync(full)))
    }
  }
  walk(root)
  return map
}

// The Dropbox-API-Arg header must be ASCII; escape non-ASCII as \uXXXX.
const apiArg = (obj: unknown) =>
  JSON.stringify(obj).replace(/[\u0080-\uffff]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))

async function rpc(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { ...authHeaderLazy(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

async function listAll(root: string): Promise<any[]> {
  const out: any[] = []
  let r = await rpc('/files/list_folder', { path: root, recursive: true, limit: 2000 })
  out.push(...r.entries)
  while (r.has_more) {
    r = await rpc('/files/list_folder/continue', { cursor: r.cursor })
    out.push(...r.entries)
  }
  return out
}

async function download(path: string): Promise<Uint8Array> {
  const res = await fetch(`${CONTENT}/files/download`, {
    method: 'POST',
    headers: { ...authHeaderLazy(), 'Dropbox-API-Arg': apiArg({ path }) },
  })
  if (!res.ok) throw new Error(`download ${path} → ${res.status}: ${await res.text()}`)
  return new Uint8Array(await res.arrayBuffer())
}

async function upload(path: string, bytes: Uint8Array): Promise<void> {
  const res = await fetch(`${CONTENT}/files/upload`, {
    method: 'POST',
    headers: {
      ...authHeaderLazy(),
      'Dropbox-API-Arg': apiArg({ path, mode: 'overwrite', mute: true }),
      'Content-Type': 'application/octet-stream',
    },
    body: bytes,
  })
  if (!res.ok) throw new Error(`upload ${path} → ${res.status}: ${await res.text()}`)
}

async function main() {
  // Self-test: run the full core round-trip on the local example_v1.scriv fixture,
  // no Dropbox / token needed. Confirms the engine runs headless in Node.
  if (args.includes('--selftest')) {
    const session = ProjectSession.open(readLocalScriv('example_v1.scriv'))
    console.log('binder: ' + session.binderTree().map((n) => n.title || '(untitled)').join(' · '))
    const out = session.exportFiles()
    console.log(
      `selftest OK — core runs headless. exported ${out.size} files, ` +
        `docs.checksum regenerated: ${out.has('Files/Data/docs.checksum')}`,
    )
    return
  }

  if (!source) throw new Error('Usage: npm run dg0 -- "<dropbox path>" --token-file <file>')

  // Discovery mode: a non-.scriv path lists the projects inside it.
  if (!source.toLowerCase().endsWith('.scriv')) {
    const entries = await listAll(source)
    const projects = entries
      .filter((e) => e['.tag'] === 'folder' && e.name.toLowerCase().endsWith('.scriv'))
      .map((e) => e.path_display)
      .sort()
    console.log(`Found ${projects.length} .scriv project(s) under ${source}:`)
    projects.forEach((p) => console.log('  ' + p))
    console.log('\nRe-run with one of those paths to round-trip it.')
    return
  }

  const name = source.slice(source.lastIndexOf('/') + 1) // foo.scriv
  const parent = source.slice(0, source.lastIndexOf('/')) // /ebooks/book
  const dest = argVal('--dest') ?? `${parent}/${name.replace(/\.scriv$/i, '')}-dg0.scriv`
  if (dest.toLowerCase() === source.toLowerCase()) throw new Error('Refusing to overwrite the source project.')

  console.log(`DG0 round-trip\n  source: ${source}\n  dest:   ${dest}\n`)

  console.log('· downloading…')
  const files = (await listAll(source)).filter((e) => e['.tag'] === 'file')
  const map = new Map<string, Uint8Array>()
  for (const f of files) {
    const rel = f.path_display.slice(parent.length + 1) // "foo.scriv/Files/..."
    map.set(rel, await download(f.path_display))
  }
  console.log(`  ${map.size} files`)

  console.log('· null round-trip through the Bartleby core…')
  const session = ProjectSession.open(map)
  console.log('  binder: ' + session.binderTree().map((n) => n.title || '(untitled)').join(' · '))
  const out = session.exportFiles() // caches stripped, docs.checksum regenerated

  console.log(`· uploading ${out.size} files to ${dest}…`)
  for (const [rel, bytes] of out) await upload(`${dest}/${rel}`, bytes)

  console.log(
    `\n✅ DONE. Let the Dropbox desktop client finish syncing, then open:\n   ${dest}\n   in Mac Scrivener. Pass = opens clean, binder + text intact (that's DG0).`,
  )
}

main().catch((e) => {
  console.error('\n❌ DG0 failed:', e.message)
  process.exit(1)
})
