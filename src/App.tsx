import { useCallback, useState } from 'react'
import { ProjectSession, type BinderNode } from './app/session'
import { exportZip } from './app/zipio'
import { writeProjectDelta } from './app/fsio'
import OpenScreen from './ui/OpenScreen'
import BinderTree, { isFolderType } from './ui/BinderTree'
import EditorPane from './ui/EditorPane'
import AddDocumentDialog from './ui/AddDocumentDialog'

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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [exporting, setExporting] = useState(false)
  // bump to re-render after session mutations (session is a mutable class instance)
  const [, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  if (!session) {
    return (
      <OpenScreen
        onOpen={(s, handle) => {
          setSession(s)
          setDirHandle(handle)
          setBackupDone(false)
          setSaveStatus(null)
          setSelected(null)
        }}
      />
    )
  }

  const selectNode = (node: BinderNode) => {
    setSelected(node)
    setSidebarOpen(false)
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

  const doExport = async () => {
    setExporting(true)
    try {
      const blob = await exportZip(session.exportFiles(), `${session.projectName}.scriv`)
      downloadBlob(blob, `${session.projectName}-edited.scriv.zip`)
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
      setSaveStatus('Saved to folder ✓')
      setTimeout(() => setSaveStatus(null), 3000)
    } catch (e) {
      setSaveStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const closeProject = () => {
    if (
      session.isDirty() &&
      !window.confirm('You have unsaved changes. Close the project anyway?')
    ) {
      return
    }
    setSession(null)
    setDirHandle(null)
    setSelected(null)
  }

  return (
    <div className="flex h-full flex-col bg-stone-900">
      <header className="flex items-center gap-2 border-b border-stone-800 px-3 py-2">
        <button
          aria-label="Toggle binder"
          className="rounded p-2 text-stone-300 hover:bg-stone-800 md:hidden"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          ☰
        </button>
        <span className="font-serif text-lg text-amber-100">Bartleby</span>
        <span className="truncate text-sm text-stone-400">
          {session.projectName}.scriv
          {session.isDirty() && <span className="ml-1 text-amber-400">●</span>}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {saveStatus && (
            <span
              className={`text-xs ${saveStatus.startsWith('Save failed') ? 'text-red-400' : 'text-emerald-400'}`}
            >
              {saveStatus}
            </span>
          )}
          <button
            onClick={() => setShowAdd(true)}
            className="rounded border border-stone-700 px-3 py-1.5 text-sm text-stone-200 hover:bg-stone-800"
          >
            Add document
          </button>
          {dirHandle && (
            <button
              onClick={saveToFolder}
              disabled={!session.isDirty()}
              className="rounded bg-amber-700 px-3 py-1.5 text-sm font-medium text-amber-50 hover:bg-amber-600 disabled:opacity-40"
            >
              Save to project folder
            </button>
          )}
          <button
            onClick={doExport}
            disabled={exporting}
            className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
              dirHandle
                ? 'border border-stone-700 text-stone-200 hover:bg-stone-800'
                : 'bg-amber-700 text-amber-50 hover:bg-amber-600'
            }`}
          >
            {exporting ? 'Exporting…' : 'Export copy (.zip)'}
          </button>
          <button
            onClick={closeProject}
            className="rounded px-3 py-1.5 text-sm text-stone-400 hover:bg-stone-800"
          >
            Close
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <aside
          className={`absolute inset-y-0 left-0 z-10 w-72 border-r border-stone-800 bg-stone-950 transition-transform md:static md:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <BinderTree
            roots={session.binderTree()}
            selected={selected?.uuid ?? null}
            isDirty={(uuid) => session.isDirty(uuid)}
            onSelect={selectNode}
          />
        </aside>
        {sidebarOpen && (
          <div
            className="absolute inset-0 z-[5] bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <main className="min-w-0 flex-1">
          <EditorPane
            node={selected}
            text={selected && !isFolderType(selected.type) ? session.readDoc(selected.uuid) : ''}
            onSave={saveEdit}
            onRename={renameItem}
          />
        </main>
      </div>

      {showAdd && (
        <AddDocumentDialog
          roots={session.binderTree()}
          defaultParent={selected && isFolderType(selected.type) ? selected.uuid : null}
          onAdd={addDocument}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  )
}
