import { useRef, useState } from 'react'
import { ProjectSession } from '../app/session'
import { importZip, importFileList } from '../app/zipio'
import { supportsDirectAccess, pickProjectDirectory } from '../app/fsio'

interface Props {
  onOpen: (session: ProjectSession, dirHandle: FileSystemDirectoryHandle | null) => void
}

export default function OpenScreen({ onOpen }: Props) {
  const folderRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
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

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 bg-stone-900 px-6 text-stone-200">
      <div className="text-center">
        <h1 className="font-serif text-5xl text-amber-100">Bartleby</h1>
        <p className="mt-2 max-w-md text-stone-400">
          Open a Scrivener 3 project, browse the binder, edit document text, and
          save your changes back — with a backup made first.
        </p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <button
          disabled={busy}
          onClick={() => {
            if (direct) {
              void openFrom(async () => {
                const picked = await pickProjectDirectory()
                return picked ? { files: picked.files, handle: picked.handle } : null
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
          Open a zipped project (.zip)
        </button>
        <p className="text-center text-xs text-stone-500">
          {direct
            ? 'Folder mode can save changes straight back into the project. Zip mode exports a copy.'
            : 'This browser can’t write to folders — you’ll export an edited copy as a zip. On phones, zip the .scriv folder first.'}
        </p>
      </div>

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
        accept=".zip,application/zip"
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
