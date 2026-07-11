import { useEffect, useState } from 'react'
import type { BinderNode } from '../app/session'
import { isFolderType } from './BinderTree'

interface Props {
  node: BinderNode | null
  /** current projection text for the selected node */
  text: string
  onSave: (newText: string) => string | null // returns error message or null
  onRename: (title: string) => string | null // returns error message or null
}

export default function EditorPane({ node, text, onSave, onRename }: Props) {
  const [draft, setDraft] = useState(text)
  const [titleDraft, setTitleDraft] = useState(node?.title ?? '')
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    setDraft(text)
    setTitleDraft(node?.title ?? '')
    setError(null)
  }, [node?.uuid, node?.title, text])

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center text-stone-500">
        Select a document in the binder to read or edit it.
      </div>
    )
  }

  const isFolder = isFolderType(node.type)
  const modified = draft !== text

  const commitTitle = () => {
    const next = titleDraft.trim()
    if (next === node.title) return
    const err = onRename(next)
    if (err) {
      setError(err)
      setTitleDraft(node.title) // revert on failure
    }
  }

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
        <span className="shrink-0 text-lg">{isFolder ? '📁' : '📄'}</span>
        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            } else if (e.key === 'Escape') {
              setTitleDraft(node.title)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          aria-label="Document title"
          placeholder="(untitled)"
          className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 font-medium text-stone-200 outline-none hover:bg-stone-800/50 focus:bg-stone-800 focus:ring-1 focus:ring-amber-700"
        />
        <span className="hidden shrink-0 truncate text-xs text-stone-600 sm:inline">{node.uuid}</span>
        {!isFolder && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
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
        )}
      </div>
      {error && (
        <p className="border-b border-red-900 bg-red-950 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {isFolder ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-stone-500">
          <span className="text-3xl">📁</span>
          <p>
            <span className="text-stone-300">{node.title || '(untitled)'}</span> is a folder ·{' '}
            {node.children.length} item{node.children.length === 1 ? '' : 's'}
          </p>
          <p className="text-sm">Use “Add document” to create a new document inside it.</p>
        </div>
      ) : (
        <>
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
        </>
      )}
    </div>
  )
}
