import { useState } from 'react'
import { ProjectSession } from '../app/session'
import { whoami, listScrivProjects, downloadProject, type DropboxProject } from '../app/dropboxio'

interface Props {
  onOpen: (
    session: ProjectSession,
    token: string,
    scrivPath: string,
    baseHashes: Map<string, string>,
  ) => void
  onClose: () => void
}

export default function DropboxDialog({ onOpen, onClose }: Props) {
  const [token, setToken] = useState('')
  const [root, setRoot] = useState('/ebooks')
  const [account, setAccount] = useState<string | null>(null)
  const [projects, setProjects] = useState<DropboxProject[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      const t = token.trim()
      setAccount(await whoami(t))
      setProjects(await listScrivProjects(t, root.trim() || ''))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const open = async (p: DropboxProject) => {
    setBusy(true)
    setError(null)
    try {
      const { files, hashes } = await downloadProject(token.trim(), p.path)
      onOpen(ProjectSession.open(files), token.trim(), p.path, hashes)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-edge bg-canvas p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-medium text-accent">Open from Dropbox</h3>

        {!projects ? (
          <>
            <p className="mt-1 text-xs text-ink-soft">
              Paste a Dropbox access token — it stays in this browser session only, never stored.
            </p>
            <label className="mt-3 block text-sm text-ink-soft">
              Access token
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="sl.xxxxx"
                autoComplete="off"
                className="mt-1 w-full rounded border border-edge bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="mt-3 block text-sm text-ink-soft">
              Folder to search
              <input
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                placeholder="/ebooks"
                className="mt-1 w-full rounded border border-edge bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
              />
            </label>
            <button
              disabled={busy || !token.trim()}
              onClick={connect}
              className="mt-4 rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-40"
            >
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </>
        ) : (
          <>
            <p className="mt-1 text-xs text-ink-soft">
              Connected as {account} · {projects.length} project{projects.length === 1 ? '' : 's'} in {root}
            </p>
            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
              {projects.length === 0 && (
                <p className="text-sm text-ink-faint">No .scriv projects found in that folder.</p>
              )}
              {projects.map((p) => (
                <button
                  key={p.path}
                  disabled={busy}
                  onClick={() => open(p)}
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-ink hover:bg-surface disabled:opacity-40"
                >
                  <span className="shrink-0">📖</span>
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setProjects(null)}
              className="mt-2 self-start text-xs text-ink-soft hover:text-accent"
            >
              ← use a different token / folder
            </button>
          </>
        )}

        {error && (
          <p className="mt-3 max-h-24 overflow-y-auto rounded border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}
        {busy && <p className="mt-2 text-center text-sm text-ink-soft">Working…</p>}
        <button
          onClick={onClose}
          className="mt-4 self-end rounded px-3 py-1.5 text-sm text-ink-soft hover:bg-surface"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
