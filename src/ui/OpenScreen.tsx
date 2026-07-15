import { useRef, useState } from 'react'
import { ProjectSession } from '../app/session'
import { importZip, importFileList } from '../app/zipio'
import { supportsDirectAccess, pickProjectDirectory, readProject } from '../app/fsio'
import type { RecoveryRecord } from '../app/recovery'
import DropboxDialog from './DropboxDialog'

interface Props {
  onOpen: (session: ProjectSession, dirHandle: FileSystemDirectoryHandle | null) => void
  onOpenDropbox: (
    session: ProjectSession,
    token: string,
    scrivPath: string,
    baseHashes: Map<string, string>,
  ) => void
  recovery: RecoveryRecord | null
  onRestore: () => void
  onDiscard: () => void
}

export default function OpenScreen({ onOpen, onOpenDropbox, recovery, onRestore, onDiscard }: Props) {
  const folderRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [choices, setChoices] = useState<FileSystemDirectoryHandle[] | null>(null)
  const [showDropbox, setShowDropbox] = useState(false)
  const direct = supportsDirectAccess()

  const openFrom = async (
    load: () => Promise<{
      files: Map<string, Uint8Array>
      handle: FileSystemDirectoryHandle | null
    } | null>,
  ) => {
    setBusy(true)
    setError(null)
    try {
      const result = await load()
      if (result === null) return // user cancelled the picker
      if (result.files.size === 0) {
        setError('No files found in the selection.')
        return
      }
      onOpen(ProjectSession.open(result.files), result.handle)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const chooseProject = (handle: FileSystemDirectoryHandle) => {
    setChoices(null)
    void openFrom(async () => {
      const project = await readProject(handle)
      return { files: project.files, handle: project.handle }
    })
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-stone-900 px-6 text-stone-200">
      <div className="text-center">
        <h1 className="font-serif text-5xl text-amber-100">Bartleby</h1>
        <p className="mt-2 max-w-md text-stone-400">
          Open a Scrivener 3 project, browse the binder, edit document text, and
          save your changes back — with a backup made first.
        </p>
      </div>

      {recovery && (
        <div className="flex w-full max-w-sm flex-col gap-2 rounded-lg border border-amber-800 bg-amber-950/40 p-4">
          <p className="text-sm text-amber-100">
            Continue where you left off — <span className="font-medium">{recovery.projectName}.scriv</span>
          </p>
          <p className="text-xs text-stone-400">
            Auto-saved backup in this browser · {new Date(recovery.savedAt).toLocaleString()}
          </p>
          <div className="mt-1 flex gap-2">
            <button
              onClick={onRestore}
              className="rounded bg-amber-700 px-4 py-1.5 text-sm font-medium text-amber-50 hover:bg-amber-600"
            >
              Restore
            </button>
            <button
              onClick={onDiscard}
              className="rounded px-3 py-1.5 text-sm text-stone-400 hover:bg-stone-800"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="flex w-full max-w-sm flex-col gap-3">
        <button
          disabled={busy}
          onClick={() => {
            if (direct) {
              void openFrom(async () => {
                const res = await pickProjectDirectory()
                if (!res) return null
                if (res.kind === 'choose') {
                  setChoices(res.candidates) // several projects — let the user pick one
                  return null
                }
                return { files: res.project.files, handle: res.project.handle }
              })
            } else {
              folderRef.current?.click()
            }
          }}
          className="rounded-lg bg-amber-700 px-5 py-3 font-medium text-amber-50 transition hover:bg-amber-600 disabled:opacity-50"
        >
          Open a .scriv project folder
        </button>
        <button
          disabled={busy}
          onClick={() => zipRef.current?.click()}
          className="rounded-lg border border-stone-600 px-5 py-3 font-medium text-stone-200 transition hover:bg-stone-800 disabled:opacity-50"
        >
          Open a project or .zip (copy)
        </button>
        <button
          disabled={busy}
          onClick={() => setShowDropbox(true)}
          className="rounded-lg border border-sky-800 bg-sky-950/40 px-5 py-3 font-medium text-sky-100 transition hover:bg-sky-900/50 disabled:opacity-50"
        >
          Open from Dropbox (beta)
        </button>
        <p className="text-center text-xs text-stone-500">
          {direct
            ? 'Folder mode saves changes straight back into the project — on macOS, pick the folder that CONTAINS your .scriv. The other button opens a .scriv or .zip as a copy (edit + export a new copy; the original isn’t touched).'
            : 'This browser can’t write to folders — open a .scriv or .zip and export an edited copy. On phones, zip the .scriv folder first.'}
        </p>
      </div>

      {showDropbox && (
        <DropboxDialog
          onOpen={(s, token, scrivPath, baseHashes) => {
            setShowDropbox(false)
            onOpenDropbox(s, token, scrivPath, baseHashes)
          }}
          onClose={() => setShowDropbox(false)}
        />
      )}

      {choices && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-6">
          <div className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-lg border border-stone-700 bg-stone-900 p-4">
            <h2 className="mb-1 font-medium text-amber-100">Choose a project</h2>
            <p className="mb-3 text-xs text-stone-400">
              {choices.length} Scrivener projects in that folder. Which one?
            </p>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {choices.map((h) => (
                <button
                  key={h.name}
                  onClick={() => chooseProject(h)}
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-stone-200 hover:bg-stone-800"
                >
                  <span className="shrink-0">📖</span>
                  <span className="truncate">{h.name}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setChoices(null)}
              className="mt-3 self-end rounded px-3 py-1.5 text-sm text-stone-400 hover:bg-stone-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {busy && <p className="text-sm text-stone-400">Reading project…</p>}
      {error && (
        <p className="max-w-md rounded-md border border-red-800 bg-red-950 px-4 py-2 text-center text-sm text-red-300">
          {error}
        </p>
      )}

      <input
        ref={folderRef}
        type="file"
        // @ts-expect-error webkitdirectory is non-standard but widely supported
        webkitdirectory=""
        multiple
        className="hidden"
        onChange={(e) => {
          const list = e.target.files
          if (list && list.length > 0) {
            void openFrom(async () => ({ files: await importFileList(list), handle: null }))
          }
          e.target.value = ''
        }}
      />
      <input
        ref={zipRef}
        type="file"
        accept=".zip,.scriv,application/zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            void openFrom(async () => ({
              files: await importZip(await file.arrayBuffer()),
              handle: null,
            }))
          }
          e.target.value = ''
        }}
      />
    </div>
  )
}
