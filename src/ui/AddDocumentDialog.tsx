import { useState } from 'react'
import type { BinderNode } from '../app/session'
import { isFolderType } from './BinderTree'

interface Props {
  roots: BinderNode[]
  defaultParent: string | null
  onAdd: (parentUuid: string | null, title: string) => string | null
  onClose: () => void
}

function folderOptions(
  nodes: BinderNode[],
  depth = 0,
): { uuid: string; label: string }[] {
  const out: { uuid: string; label: string }[] = []
  for (const n of nodes) {
    if (isFolderType(n.type)) {
      out.push({ uuid: n.uuid, label: `${' '.repeat(depth * 3)}${n.title || '(untitled)'}` })
      out.push(...folderOptions(n.children, depth + 1))
    }
  }
  return out
}

export default function AddDocumentDialog({ roots, defaultParent, onAdd, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [parent, setParent] = useState<string>(defaultParent ?? '')
  const [error, setError] = useState<string | null>(null)
  const folders = folderOptions(roots)

  const submit = () => {
    if (!title.trim()) {
      setError('Give the document a title.')
      return
    }
    const err = onAdd(parent || null, title.trim())
    if (err) setError(err)
    else onClose()
  }

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-stone-700 bg-stone-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-medium text-stone-100">Add document</h3>
        <label className="mt-4 block text-sm text-stone-400">
          Title
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            className="mt-1 w-full rounded border border-stone-700 bg-stone-800 px-3 py-2 text-stone-100 outline-none focus:border-amber-600"
            placeholder="New scene"
          />
        </label>
        <label className="mt-3 block text-sm text-stone-400">
          Location
          <select
            value={parent}
            onChange={(e) => setParent(e.target.value)}
            className="mt-1 w-full rounded border border-stone-700 bg-stone-800 px-3 py-2 text-stone-100 outline-none focus:border-amber-600"
          >
            <option value="">Binder root</option>
            {folders.map((f) => (
              <option key={f.uuid} value={f.uuid}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-4 py-2 text-sm text-stone-300 hover:bg-stone-800"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="rounded bg-amber-700 px-4 py-2 text-sm font-medium text-amber-50 hover:bg-amber-600"
          >
            Add document
          </button>
        </div>
      </div>
    </div>
  )
}
