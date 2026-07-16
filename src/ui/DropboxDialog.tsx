import { useEffect, useReducer, useState } from 'react'
import { ProjectSession } from '../app/session'
import { whoami, listScrivProjects, downloadProject, type DropboxProject } from '../app/dropboxio'
import { loadBrowseCache, saveBrowseCache, timeAgo } from '../app/browsecache'
import {
  beginAuth,
  getAccessToken,
  isConfigured,
  isConnected,
  isOAuthConnected,
  setManualToken,
  disconnect,
  subscribeAuth,
} from '../app/dropboxauth'

interface Props {
  onOpen: (session: ProjectSession, scrivPath: string, baseHashes: Map<string, string>) => void
  onClose: () => void
}

export default function DropboxDialog({ onOpen, onClose }: Props) {
  const [token, setToken] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [root, setRoot] = useState('/ebooks')
  const [account, setAccount] = useState<string | null>(null)
  const [projects, setProjects] = useState<DropboxProject[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** epoch ms of the cached listing being shown, null once live */
  const [cachedAt, setCachedAt] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // On native the auth code arrives by deep link with no page reload, so
  // nothing would re-render this dialog without an explicit subscription.
  const [, bumpAuth] = useReducer((n: number) => n + 1, 0)
  useEffect(() => subscribeAuth(bumpAuth), [])
  const connected = isConnected()

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))

  /**
   * List .scriv projects. `background` refreshes behind an already-shown cached
   * list: no spinner, and a failure leaves the cached list in place rather than
   * blanking the screen (being offline shouldn't hide your projects).
   */
  const browse = async (folder = root, background = false) => {
    const dir = folder.trim() || ''
    if (background) setRefreshing(true)
    else setBusy(true)
    if (!background) setError(null)
    try {
      const t = await getAccessToken()
      const [who, list] = await Promise.all([
        account ? Promise.resolve(account) : whoami(t),
        listScrivProjects(t, dir),
      ])
      setAccount(who)
      setProjects(list)
      setCachedAt(null)
      void saveBrowseCache({ root: dir, account: who, projects: list, at: Date.now() })
    } catch (e) {
      if (!background) fail(e)
    } finally {
      setBusy(false)
      setRefreshing(false)
    }
  }

  // Show the last-known project list immediately, then refresh behind it.
  useEffect(() => {
    let alive = true
    void (async () => {
      const cache = await loadBrowseCache()
      if (!alive || !cache) return
      setRoot(cache.root)
      setAccount(cache.account)
      if (!isConnected() || cache.projects.length === 0) return
      setProjects(cache.projects)
      setCachedAt(cache.at)
      void browse(cache.root, true)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const useManualToken = async () => {
    setManualToken(token.trim())
    await browse()
  }

  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      await beginAuth() // web navigates away; native opens a browser and deep-links back
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const open = async (p: DropboxProject) => {
    setBusy(true)
    setError(null)
    try {
      const { files, hashes } = await downloadProject(await getAccessToken(), p.path)
      onOpen(ProjectSession.open(files), p.path, hashes)
    } catch (e) {
      fail(e)
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

        {projects ? (
          <>
            <p className="mt-1 text-xs text-ink-soft">
              {account ? `Connected as ${account} · ` : ''}
              {projects.length} project{projects.length === 1 ? '' : 's'} in {root}
              {refreshing && <span className="text-ink-faint"> · refreshing…</span>}
              {!refreshing && cachedAt !== null && (
                <span className="text-ink-faint"> · from {timeAgo(cachedAt)}</span>
              )}
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
              ← choose a different folder
            </button>
          </>
        ) : connected ? (
          <>
            <p className="mt-1 text-xs text-ink-soft">
              {isOAuthConnected()
                ? 'Dropbox is connected — access renews itself, no tokens to manage.'
                : 'Using a pasted token (expires in about 4 hours).'}
            </p>
            <label className="mt-3 block text-sm text-ink-soft">
              Folder to search
              <input
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                placeholder="/ebooks"
                className="mt-1 w-full rounded border border-edge bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
              />
            </label>
            <div className="mt-4 flex items-center gap-2">
              <button
                disabled={busy}
                onClick={() => browse()}
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-40"
              >
                {busy ? 'Loading…' : 'Browse projects'}
              </button>
              <button
                onClick={() => {
                  disconnect()
                  setProjects(null)
                  setAccount(null)
                  setError(null)
                }}
                className="rounded px-3 py-2 text-xs text-ink-soft hover:bg-surface"
              >
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-xs text-ink-soft">
              Sign in to your own Dropbox and approve Bartleby once. Your access
              stays connected — nothing to copy or paste, and no token expiry.
            </p>
            {isConfigured() && (
              <button
                disabled={busy}
                onClick={connect}
                className="mt-4 rounded-lg bg-sky-700 px-5 py-3 text-sm font-medium text-sky-50 hover:bg-sky-600 disabled:opacity-40"
              >
                {busy ? 'Redirecting…' : 'Connect Dropbox'}
              </button>
            )}

            {!isConfigured() && (
              <p className="mt-3 rounded border border-edge bg-surface px-3 py-2 text-xs text-ink-faint">
                No Dropbox app key is configured for this build, so paste a token
                below instead.
              </p>
            )}

            <button
              onClick={() => setShowManual(!showManual)}
              className="mt-3 self-start text-xs text-ink-faint hover:text-accent"
            >
              {showManual ? '− hide' : '+ advanced:'} paste a token instead
            </button>
            {showManual && (
              <>
                <label className="mt-2 block text-sm text-ink-soft">
                  Access token
                  <input
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder="sl.xxxxx"
                    autoComplete="off"
                    className="mt-1 w-full rounded border border-edge bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
                  />
                </label>
                <label className="mt-2 block text-sm text-ink-soft">
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
                  onClick={useManualToken}
                  className="mt-3 self-start rounded border border-edge px-4 py-2 text-sm text-ink hover:bg-surface disabled:opacity-40"
                >
                  {busy ? 'Connecting…' : 'Use this token'}
                </button>
              </>
            )}
          </>
        )}

        {error && (
          <p className="mt-3 max-h-24 overflow-y-auto rounded border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}
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
