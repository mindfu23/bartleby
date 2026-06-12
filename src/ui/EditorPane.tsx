import { useEffect, useState } from 'react'
import type { BinderNode } from '../app/session'
import { isFolderType } from './BinderTree'

interface Props {
  node: BinderNode | null
  /** current projection text for the selected node */
  text: string
  onSave: (newText: string) => string | null // returns error message or null
}

export default function EditorPane({ node, text, onSave }: Props) {
  const [draft, setDraft] = useState(text)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    setDraft(text)
    setError(null)
  }, [node?.uuid, text])

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center text-stone-500">
        Select a document in the binder to read or edit it.
      </div>
    )
  }

  if (isFolderType(node.type)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-stone-500">
        <span className="text-3xl">📁</span>
        <p>
          <span className="text-stone-300">{node.title}</span> is a folder ·{' '}
          {node.children.length} item{node.children.length === 1 ? '' : 's'}
        </p>
        <p className="text-sm">Use “Add document” to create a new document inside it.</p>
      </div>
    )
  }

  const modified = draft !== text

  const save = () => {
    const err = onSave(draft)
    setError(err)
    if (!err) {
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-stone-800 px-4 py-2">
        <h2 className="truncate font-medium text-stone-200">{node.title || '(untitled)'}</h2>
        <span className="hidden truncate text-xs text-stone-600 sm:inline">{node.uuid}</span>
        <div className="ml-auto flex items-center gap-2">
          {modified && <span className="text-xs text-amber-400">unsaved changes</span>}
          {savedFlash && !modified && <span className="text-xs text-emerald-400">saved ✓</span>}
          <button
            disabled={!modified}
            onClick={save}
            className="rounded bg-amber-700 px-4 py-1.5 text-sm font-medium text-amber-50 transition hover:bg-amber-600 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
      {error && (
        <p className="border-b border-red-900 bg-red-950 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck
        className="min-h-0 flex-1 resize-none bg-stone-900 p-4 font-serif text-base leading-relaxed text-stone-100 outline-none"
        placeholder="This document is empty. Start typing…"
      />
      <p className="border-t border-stone-800 px-4 py-1.5 text-xs text-stone-600">
        Plain-text editing: formatting outside your edits is preserved byte-for-byte;
        text you change is written back unformatted.
      </p>
    </div>
  )
}
