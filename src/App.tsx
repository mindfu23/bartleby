import { useCallback, useEffect, useState } from 'react'
import { ProjectSession, type BinderNode, type MovePosition } from './app/session'
import { exportZip } from './app/zipio'
import { writeProjectDelta } from './app/fsio'
import { saveRecovery, loadRecovery, clearRecovery, type RecoveryRecord } from './app/recovery'
import {
  uploadProject,
  saveProjectInPlace,
  projectHashes,
  hashesEqual,
  copyFolder,
  bartlebyCopyPath,
  conflictCopyPath,
  backupCopyPath,
  DropboxError,
} from './app/dropboxio'
import OpenScreen from './ui/OpenScreen'
import BinderTree, { isFolderType } from './ui/BinderTree'
import EditorPane from './ui/EditorPane'
import AddDocumentDialog from './ui/AddDocumentDialog'
import MoveDialog from './ui/MoveDialog'
import SettingsDialog from './ui/SettingsDialog'
import InsightsPanel from './ui/InsightsPanel'

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [session, setSession] = useState<ProjectSession | null>(null)
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [backupDone, setBackupDone] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [selected, setSelected] = useState<BinderNode | null>(null)
  // Mobile app-shell tab (bottom nav). Desktop keeps the two-pane layout and
  // ignores this. 'write' = editor, 'outline' = binder, 'insights' = stats.
  const [mobileTab, setMobileTab] = useState<'outline' | 'write' | 'insights'>('outline')
  const [showSettings, setShowSettings] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [showMove, setShowMove] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [recovery, setRecovery] = useState<RecoveryRecord | null>(null)
  // Set when the project was opened from Dropbox; enables Dropbox saves. `base`
  // is the server file-hash map at open time, for conflict detection.
  const [dropbox, setDropbox] = useState<{
    token: string
    scrivPath: string
    base: Map<string, string>
  } | null>(null)
  const [showDbxSave, setShowDbxSave] = useState(false)
  // bump to re-render after session mutations (session is a mutable class instance)
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  // On first load, surface any previously-persisted working session.
  useEffect(() => {
    void loadRecovery().then((r) => setRecovery(r))
  }, [])

  // Tier 2 auto-save: debounce-persist the working session, but ONLY while it has
  // unexported changes — a clean (exported/saved) project needs no recovery copy.
  useEffect(() => {
    if (!session) return
    const t = setTimeout(() => {
      if (session.isDirty()) void saveRecovery(session.serialize())
    }, 2000)
    return () => clearTimeout(t)
  }, [session, version])

  // Flush to recovery when the tab is hidden/backgrounded (the reliable
  // "save on close" hook — async writes can't be trusted during teardown).
  useEffect(() => {
    if (!session) return
    const onHide = () => {
      if (document.visibilityState === 'hidden' && session.isDirty()) {
        void saveRecovery(session.serialize())
      }
    }
    const onUnload = (e: BeforeUnloadEvent) => {
      if (session.isDirty()) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onUnload)
    }
  }, [session])

  if (!session) {
    return (
      <OpenScreen
        recovery={recovery}
        onRestore={() => {
          if (!recovery) return
          setSession(ProjectSession.deserialize(recovery.snapshot))
          setDirHandle(null)
          setDropbox(null)
          setBackupDone(false)
          setSaveStatus(null)
          setSelected(null)
          setRecovery(null)
        }}
        onDiscard={() => {
          void clearRecovery()
          setRecovery(null)
        }}
        onOpen={(s, handle) => {
          setSession(s)
          setDirHandle(handle)
          setDropbox(null)
          setBackupDone(false)
          setSaveStatus(null)
          setSelected(null)
          setRecovery(null)
        }}
        onOpenDropbox={(s, token, scrivPath, baseHashes) => {
          setSession(s)
          setDirHandle(null)
          setDropbox({ token, scrivPath, base: baseHashes })
          setBackupDone(false)
          setSaveStatus(null)
          setSelected(null)
          setRecovery(null)
        }}
      />
    )
  }

  const selectNode = (node: BinderNode) => {
    setSelected(node)
    // On mobile, picking an item in Outline jumps to the Write tab.
    if (!isFolderType(node.type)) setMobileTab('write')
  }

  const findByUuid = (uuid: string): BinderNode | null => {
    const walk = (nodes: BinderNode[]): BinderNode | null => {
      for (const n of nodes) {
        if (n.uuid === uuid) return n
        const hit = walk(n.children)
        if (hit) return hit
      }
      return null
    }
    return walk(session.binderTree())
  }

  /** Nearest folder containing `target` (null = binder root, undefined = not found). */
  const ancestorFolder = (
    nodes: BinderNode[],
    target: string,
    folder: string | null = null,
  ): string | null | undefined => {
    for (const n of nodes) {
      if (n.uuid === target) return folder
      const hit = ancestorFolder(n.children, target, isFolderType(n.type) ? n.uuid : folder)
      if (hit !== undefined) return hit
    }
    return undefined
  }

  /** Where "Add document" should default: the current folder / the selected item's
   *  folder, else the Draft folder, else binder root. */
  const defaultAddParent = (): string | null => {
    if (selected) {
      if (isFolderType(selected.type)) return selected.uuid
      const folder = ancestorFolder(session.binderTree(), selected.uuid)
      if (folder !== undefined) return folder
    }
    return session.binderTree().find((n) => n.type === 'DraftFolder')?.uuid ?? null
  }

  const saveEdit = (newText: string): string | null => {
    if (!selected) return null
    try {
      session.applyEdit(selected.uuid, newText)
      refresh()
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }

  const addDocument = (parentUuid: string | null, title: string): string | null => {
    try {
      const uuid = session.addDocument(parentUuid, title, '')
      refresh()
      const node = findByUuid(uuid)
      if (node) setSelected(node)
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }

  const moveItem = (dragUuid: string, refUuid: string, position: MovePosition) => {
    try {
      session.moveItem(dragUuid, refUuid, position)
      refresh()
      const node = findByUuid(dragUuid)
      if (node) setSelected(node)
    } catch {
      // illegal move (e.g. into its own descendant) — leave the binder unchanged
    }
  }

  // Touch-friendly move: pick a destination folder (or root) + top/bottom, then
  // translate to a moveItem ref/position. Mirrors the mouse drag-and-drop.
  const moveToLocation = (destFolderUuid: string | null, position: 'top' | 'bottom'): string | null => {
    if (!selected) return null
    try {
      const roots = session.binderTree()
      let refUuid: string
      let pos: MovePosition
      if (destFolderUuid) {
        const folder = findByUuid(destFolderUuid)
        if (!folder) return 'Destination folder not found.'
        if (position === 'bottom' || folder.children.length === 0) {
          refUuid = destFolderUuid
          pos = 'inside'
        } else {
          refUuid = folder.children[0].uuid
          pos = 'before'
        }
      } else if (position === 'top') {
        refUuid = roots[0].uuid
        pos = 'before'
      } else {
        refUuid = roots[roots.length - 1].uuid
        pos = 'after'
      }
      if (refUuid === selected.uuid) return null // already there
      session.moveItem(selected.uuid, refUuid, pos)
      refresh()
      const node = findByUuid(selected.uuid)
      if (node) setSelected(node)
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }

  const trashSelected = () => {
    if (!selected) return
    try {
      session.moveToTrash(selected.uuid)
      refresh()
      setSelected(null)
      setSaveStatus(`Moved “${selected.title || 'item'}” to Trash`)
      setTimeout(() => setSaveStatus(null), 4000)
    } catch (e) {
      setSaveStatus(e instanceof Error ? e.message : String(e))
    }
  }

  const renameItem = (title: string): string | null => {
    if (!selected) return null
    try {
      session.renameItem(selected.uuid, title)
      refresh()
      const node = findByUuid(selected.uuid)
      if (node) setSelected(node) // reparse produced a fresh node; keep selection current
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }

  const addComment = (start: number, end: number, text: string): string | null => {
    if (!selected) return null
    try {
      session.addComment(selected.uuid, start, end, text)
      refresh()
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }

  const editComment = (id: string, text: string) => {
    if (!selected) return
    try {
      session.editComment(selected.uuid, id, text)
      refresh()
    } catch {
      /* ignore — comment edit is best-effort */
    }
  }

  const deleteComment = (id: string) => {
    if (!selected) return
    try {
      session.deleteComment(selected.uuid, id)
      refresh()
    } catch {
      /* ignore */
    }
  }

  const doExport = async () => {
    setExporting(true)
    try {
      const blob = await exportZip(session.exportFiles(), `${session.projectName}.scriv`)
      downloadBlob(blob, `${session.projectName}-edited.scriv.zip`)
      // In zip mode the export IS the save — clear the dirty/unexported state.
      // In folder mode the source folder is still unsaved until "Save to project
      // folder", so leave it dirty there.
      if (!dirHandle) {
        session.markSaved()
        refresh()
        void clearRecovery() // work is now in the exported file; no recovery needed
        setRecovery(null)
      }
    } finally {
      setExporting(false)
    }
  }

  const saveToFolder = async () => {
    if (!dirHandle || !session.isDirty()) return
    if (
      !window.confirm(
        'Save changes directly into the project folder?\n\n' +
          'Make sure the project is CLOSED in Scrivener first. ' +
          (backupDone
            ? ''
            : 'A backup zip of the original project will be downloaded before anything is written.'),
      )
    ) {
      return
    }
    setSaveStatus('Saving…')
    try {
      if (!backupDone) {
        const backup = await exportZip(
          session.exportOriginalFiles(),
          `${session.projectName}.scriv`,
        )
        downloadBlob(backup, `${session.projectName}-backup.scriv.zip`)
        setBackupDone(true)
      }
      const { writes, deletes } = session.exportDelta()
      await writeProjectDelta(dirHandle, writes, deletes)
      session.markSaved()
      refresh()
      void clearRecovery() // saved to the source folder; no recovery needed
      setRecovery(null)
      setSaveStatus('Saved to folder ✓')
      setTimeout(() => setSaveStatus(null), 3000)
    } catch (e) {
      setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)

  const afterDropboxSave = (msg: string) => {
    session.markSaved()
    refresh()
    void clearRecovery()
    setRecovery(null)
    setSaveStatus(msg)
    setTimeout(() => setSaveStatus(null), 7000)
  }

  const dropboxErr = (e: unknown): string =>
    e instanceof DropboxError && /→ 401/.test(e.message)
      ? 'Dropbox token expired — Close and reconnect with a fresh token.'
      : `Dropbox save failed: ${e instanceof Error ? e.message : String(e)}`

  const saveDropboxCopy = async () => {
    if (!dropbox) return
    setShowDbxSave(false)
    const dest = bartlebyCopyPath(dropbox.scrivPath)
    setSaveStatus('Saving a copy to Dropbox…')
    try {
      await uploadProject(dropbox.token, dest, session.exportFiles())
      afterDropboxSave(`Saved copy → ${basename(dest)} ✓`)
    } catch (e) {
      setSaveStatus(dropboxErr(e))
    }
  }

  const saveDropboxInPlace = async () => {
    if (!dropbox) return
    setShowDbxSave(false)
    setSaveStatus('Checking Dropbox for other changes…')
    try {
      // Conflict: did the project change on another device since we opened it?
      const current = await projectHashes(dropbox.token, dropbox.scrivPath)
      if (!hashesEqual(current, dropbox.base)) {
        const dest = conflictCopyPath(dropbox.scrivPath)
        setSaveStatus('Changed elsewhere — writing a conflict copy…')
        await uploadProject(dropbox.token, dest, session.exportFiles())
        setSaveStatus(`⚠ Project changed on another device — saved to ${basename(dest)}; original untouched.`)
        return
      }
      if (!backupDone) {
        setSaveStatus('Backing up the original first…')
        await copyFolder(dropbox.token, dropbox.scrivPath, backupCopyPath(dropbox.scrivPath))
        setBackupDone(true)
      }
      setSaveStatus('Saving in place…')
      await saveProjectInPlace(dropbox.token, dropbox.scrivPath, session.exportFiles())
      setDropbox({ ...dropbox, base: await projectHashes(dropbox.token, dropbox.scrivPath) })
      afterDropboxSave('Saved in place to Dropbox ✓')
    } catch (e) {
      setSaveStatus(dropboxErr(e))
    }
  }

  const closeProject = () => {
    // Keep a recovery copy only if there are unexported changes to lose.
    if (session.isDirty()) {
      const snapshot = session.serialize()
      void saveRecovery(snapshot)
      setRecovery({ projectName: snapshot.projectName, savedAt: Date.now(), snapshot })
    } else {
      void clearRecovery()
      setRecovery(null)
    }
    setSession(null)
    setDirHandle(null)
    setDropbox(null)
    setSelected(null)
  }

  return (
    <div className="flex h-full flex-col overflow-x-hidden bg-canvas">
      <header className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        <span className="font-serif text-lg text-accent">Bartleby</span>
        <span className="truncate text-sm text-ink-soft">
          {session.projectName}.scriv
          {session.isDirty() && (
            <span className="ml-2 text-xs text-accent">● unexported changes</span>
          )}
        </span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => setShowSettings(true)}
            aria-label="Settings"
            title="Settings"
            className="rounded-full p-2 text-lg text-ink-soft hover:bg-surface"
          >
            ⚙
          </button>
          {saveStatus && (
            <span
              className={`text-xs ${saveStatus.startsWith('Save failed') ? 'text-red-400' : 'text-emerald-400'}`}
            >
              {saveStatus}
            </span>
          )}
          <button
            onClick={() => setShowAdd(true)}
            className="rounded border border-edge px-3 py-1.5 text-sm text-ink hover:bg-surface"
          >
            Add document
          </button>
          {dirHandle && (
            <button
              onClick={saveToFolder}
              disabled={!session.isDirty()}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-40"
            >
              Save to project folder
            </button>
          )}
          {dropbox && (
            <button
              onClick={() => setShowDbxSave(true)}
              className="rounded bg-sky-700 px-3 py-1.5 text-sm font-medium text-sky-50 hover:bg-sky-600"
            >
              {session.isDirty() ? '● ' : ''}Save to Dropbox
            </button>
          )}
          <button
            onClick={doExport}
            disabled={exporting}
            title={session.isDirty() ? 'You have changes to export' : undefined}
            className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
              dirHandle && !session.isDirty()
                ? 'border border-edge text-ink hover:bg-surface'
                : 'bg-accent text-on-accent hover:bg-accent-hover'
            }`}
          >
            {exporting
              ? 'Exporting…'
              : `${session.isDirty() ? '● ' : ''}Export copy (.zip)`}
          </button>
          <button
            onClick={closeProject}
            className="hidden rounded px-3 py-1.5 text-sm text-ink-soft hover:bg-surface md:inline-block"
          >
            Close
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Desktop binder — always visible in the two-pane layout. */}
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-r border-edge bg-panel md:block">
          <BinderTree
            roots={session.binderTree()}
            selected={selected?.uuid ?? null}
            isDirty={(uuid) => session.isDirty(uuid)}
            onSelect={selectNode}
            onMove={moveItem}
          />
        </aside>

        <main className="relative min-w-0 flex-1">
          {/* Editor: shown on desktop always; on mobile only for the Write tab.
              Kept mounted so an in-progress edit survives tab switches. */}
          <div className={`h-full ${mobileTab === 'write' ? 'block' : 'hidden'} md:block`}>
            <EditorPane
              node={selected}
              text={selected && !isFolderType(selected.type) ? session.readDoc(selected.uuid) : ''}
              comments={selected && !isFolderType(selected.type) ? session.getComments(selected.uuid) : []}
              onSave={saveEdit}
              onRename={renameItem}
              onAddComment={addComment}
              onEditComment={editComment}
              onDeleteComment={deleteComment}
              onMoveRequest={() => setShowMove(true)}
              onTrash={trashSelected}
            />
          </div>

          {/* Mobile Outline tab — the binder full-width. */}
          <div
            className={`h-full overflow-y-auto ${mobileTab === 'outline' ? 'block' : 'hidden'} md:hidden`}
          >
            <BinderTree
              roots={session.binderTree()}
              selected={selected?.uuid ?? null}
              isDirty={(uuid) => session.isDirty(uuid)}
              onSelect={selectNode}
              onMove={moveItem}
            />
          </div>

          {/* Mobile Insights tab — mounted only when active. */}
          {mobileTab === 'insights' && (
            <div className="h-full overflow-y-auto md:hidden">
              <InsightsPanel session={session} version={version} />
            </div>
          )}
        </main>
      </div>

      {/* Bottom navigation — mobile app shell (Figma). Desktop uses the two-pane layout. */}
      <nav className="flex shrink-0 border-t border-edge bg-panel text-ink-soft md:hidden">
        {[
          { key: 'home', label: 'Home', icon: '📚', onClick: closeProject },
          { key: 'outline', label: 'Outline', icon: '≡', onClick: () => setMobileTab('outline') },
          { key: 'write', label: 'Write', icon: '✎', onClick: () => setMobileTab('write') },
          { key: 'insights', label: 'Insights', icon: '📊', onClick: () => setMobileTab('insights') },
        ].map((tab) => {
          const active = tab.key === mobileTab
          return (
            <button
              key={tab.key}
              onClick={tab.onClick}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
                active ? 'text-accent' : 'hover:text-ink'
              }`}
            >
              <span className="text-base leading-none">{tab.icon}</span>
              {tab.label}
            </button>
          )
        })}
      </nav>

      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}

      {showAdd && (
        <AddDocumentDialog
          roots={session.binderTree()}
          defaultParent={defaultAddParent()}
          onAdd={addDocument}
          onClose={() => setShowAdd(false)}
        />
      )}

      {showMove && selected && (
        <MoveDialog
          roots={session.binderTree()}
          node={selected}
          onMove={moveToLocation}
          onClose={() => setShowMove(false)}
        />
      )}

      {showDbxSave && dropbox && (
        <div
          className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowDbxSave(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-edge bg-canvas p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium text-ink">Save to Dropbox</h3>
            <p className="mt-1 text-xs text-ink-faint">{basename(dropbox.scrivPath)}</p>
            <button
              onClick={saveDropboxCopy}
              className="mt-4 w-full rounded-lg border border-edge px-4 py-3 text-left hover:bg-surface"
            >
              <div className="text-sm font-medium text-ink">Save a copy (safe)</div>
              <div className="text-xs text-ink-soft">
                Writes {basename(bartlebyCopyPath(dropbox.scrivPath))} — your original is never touched.
              </div>
            </button>
            <button
              onClick={saveDropboxInPlace}
              className="mt-2 w-full rounded-lg border border-sky-800 bg-sky-950/40 px-4 py-3 text-left hover:bg-sky-900/40"
            >
              <div className="text-sm font-medium text-sky-100">Save in place (overwrite original)</div>
              <div className="text-xs text-ink-soft">
                Backs up the original once, checks for changes made elsewhere (→ conflict copy if so), then overwrites.
              </div>
            </button>
            <button
              onClick={() => setShowDbxSave(false)}
              className="mt-4 w-full rounded px-3 py-1.5 text-sm text-ink-soft hover:bg-surface"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
