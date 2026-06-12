import { useRef, useState } from 'react'
import { ProjectSession } from '../app/session'
import { importZip, importFileList } from '../app/zipio'

interface Props {
  onOpen: (session: ProjectSession) => void
}

export default function OpenScreen({ onOpen }: Props) {
  const folderRef = useRef<HTMLInputElement>(null)
  const zipRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const openFrom = async (load: () => Promise<Map<string, Uint8Array>>) => {
    setBusy(true)
    setError(null)
    try {
      const files = await load()
      if (files.size === 0) {
        setError('No files found in the selection.')
        return
      }
      onOpen(ProjectSession.open(files))
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
          export a clean copy — your original is never touched.
        </p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <button
          disabled={busy}
          onClick={() => folderRef.current?.click()}
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
          On phones and tablets, zip the .scriv folder first — mobile browsers
          can’t pick folders.
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
          if (list && list.length > 0) void openFrom(() => importFileList(list))
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
          if (file) void openFrom(async () => importZip(await file.arrayBuffer()))
          e.target.value = ''
        }}
      />
    </div>
  )
}
