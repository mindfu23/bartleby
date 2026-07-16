import { useEffect, useRef, useState } from 'react'
import type { BinderNode, DocComment } from '../app/session'
import { isFolderType, isFixedRoot } from './BinderTree'

const AUTOSAVE_IDLE_MS = 2000

interface Props {
  node: BinderNode | null
  /** current projection text for the selected node */
  text: string
  comments: DocComment[]
  onSave: (newText: string) => string | null // returns error message or null
  onRename: (title: string) => string | null // returns error message or null
  onAddComment: (start: number, end: number, text: string) => string | null
  onEditComment: (id: string, text: string) => void
  onDeleteComment: (id: string) => void
  onMoveRequest: () => void
  onTrash: () => void
}

/** Scrivener stores comment colours as "r g b" floats 0–1. */
function scrivColorToCss(color: string): string {
  const p = color.trim().split(/\s+/).map(Number)
  if (p.length >= 3 && p.slice(0, 3).every((n) => !Number.isNaN(n))) {
    const [r, g, b] = p.slice(0, 3).map((n) => Math.round(n * 255))
    return `rgb(${r}, ${g}, ${b})`
  }
  return '#c8a13a'
}

export default function EditorPane({
  node, text, comments, onSave, onRename, onAddComment, onEditComment, onDeleteComment,
  onMoveRequest, onTrash,
}: Props) {
  const [draft, setDraft] = useState(text)
  const [titleDraft, setTitleDraft] = useState(node?.title ?? '')
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Last text selection, tracked so the Comment button can use it even after the
  // textarea blurs (clicking the button would otherwise collapse the selection).
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 })
  // Inline comment composer (add/edit). We can't use window.prompt — it's blocked
  // in sandboxed iframes like VS Code's Simple Browser.
  type CommentDraft = { mode: 'add'; start: number; end: number } | { mode: 'edit'; id: string }
  const [commentDraft, setCommentDraft] = useState<CommentDraft | null>(null)
  const [commentInput, setCommentInput] = useState('')

  const isFolder = node ? isFolderType(node.type) : false
  const titleChanged = !!node && titleDraft.trim() !== node.title
  const bodyChanged = !!node && !isFolder && draft !== text
  const modified = titleChanged || bodyChanged

  // Save commits whatever is pending — the retitle, the body edit, or both.
  const save = () => {
    if (!node || !modified) return
    let err: string | null = null
    if (titleChanged) err = onRename(titleDraft.trim())
    if (!err && bodyChanged) err = onSave(draft)
    setError(err)
    if (!err) {
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1500)
    }
  }

  // All hooks must run unconditionally (before any early return). A ref keeps the
  // auto-save timer calling the latest save() without re-arming every render.
  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    setDraft(text)
    setTitleDraft(node?.title ?? '')
    setError(null)
  }, [node?.uuid, node?.title, text])

  // Tier 1 auto-save: commit after AUTOSAVE_IDLE_MS of no edits.
  useEffect(() => {
    if (!modified) return
    const t = setTimeout(() => saveRef.current(), AUTOSAVE_IDLE_MS)
    return () => clearTimeout(t)
  }, [draft, titleDraft, modified])

  const startAddComment = () => {
    const { start, end } = selectionRef.current
    if (end <= start) {
      setError('Select some text in the document to comment on.')
      return
    }
    // Commit a pending body edit first so these offsets match the saved projection.
    if (bodyChanged) {
      const err = onSave(draft)
      if (err) {
        setError(err)
        return
      }
    }
    setError(null)
    setCommentInput('')
    setCommentDraft({ mode: 'add', start, end })
  }

  const startEditComment = (id: string, current: string) => {
    setError(null)
    setCommentInput(current)
    setCommentDraft({ mode: 'edit', id })
  }

  const submitComment = () => {
    if (!commentDraft) return
    if (commentDraft.mode === 'add') {
      const t = commentInput.trim()
      if (t) setError(onAddComment(commentDraft.start, commentDraft.end, t))
    } else {
      onEditComment(commentDraft.id, commentInput)
    }
    setCommentDraft(null)
    setCommentInput('')
  }

  const cancelComment = () => {
    setCommentDraft(null)
    setCommentInput('')
  }

  // Reveal a comment's anchored text by selecting it in the editor.
  const selectAnchor = (range: { start: number; end: number } | null) => {
    const ta = textareaRef.current
    if (!ta || !range) return
    ta.focus()
    ta.setSelectionRange(range.start, range.end)
  }

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint">
        Select a document in the binder to read or edit it.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-edge px-4 py-2">
        <span className="shrink-0 text-lg">{isFolder ? '📁' : '📄'}</span>
        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            } else if (e.key === 'Escape') {
              setTitleDraft(node.title)
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          aria-label="Document title"
          placeholder="(untitled)"
          className={`min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 font-medium text-ink outline-none hover:bg-surface/50 focus:bg-surface focus:ring-1 focus:ring-accent ${
            titleChanged ? 'ring-1 ring-accent' : ''
          }`}
        />
        <span className="hidden shrink-0 truncate text-xs text-ink-faint sm:inline">{node.uuid}</span>
        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
          {!isFixedRoot(node.type) && (
            <>
              <button
                onClick={onMoveRequest}
                className="rounded border border-edge px-3 py-1.5 text-sm text-ink hover:bg-surface"
              >
                Move
              </button>
              <button
                onClick={onTrash}
                title="Move to Trash (recoverable)"
                className="rounded border border-edge px-3 py-1.5 text-sm text-ink-soft hover:bg-red-950 hover:text-red-200"
              >
                Delete
              </button>
            </>
          )}
          {!isFolder && (
            <button
              onMouseDown={(e) => e.preventDefault()} // keep the textarea's selection
              onClick={startAddComment}
              title="Comment on the selected text"
              className="rounded border border-edge px-3 py-1.5 text-sm text-ink hover:bg-surface"
            >
              Comment
            </button>
          )}
          {modified && <span className="text-xs text-accent">unsaved changes</span>}
          {savedFlash && !modified && <span className="text-xs text-emerald-400">saved ✓</span>}
          <button
            disabled={!modified}
            onClick={save}
            className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-on-accent transition hover:bg-accent-hover disabled:opacity-40"
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
      {isFolder ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-ink-faint">
          <span className="text-3xl">📁</span>
          <p>
            <span className="text-ink-soft">{node.title || '(untitled)'}</span> is a folder ·{' '}
            {node.children.length} item{node.children.length === 1 ? '' : 's'}
          </p>
          <p className="text-sm">Edit its title above, or use “Add document” to create one inside it.</p>
        </div>
      ) : (
        <>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onSelect={(e) =>
              (selectionRef.current = {
                start: e.currentTarget.selectionStart,
                end: e.currentTarget.selectionEnd,
              })
            }
            onBlur={save}
            spellCheck
            className="min-h-0 flex-1 resize-none bg-canvas p-4 font-serif text-base leading-relaxed text-ink outline-none"
            placeholder="This document is empty. Start typing…"
          />
          {(comments.length > 0 || commentDraft) && (
            <div className="max-h-52 shrink-0 overflow-y-auto border-t border-edge bg-panel/60">
              <p className="px-4 pt-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
                Comments ({comments.length})
              </p>
              {commentDraft && (
                <div className="flex items-center gap-2 px-4 py-2">
                  <input
                    autoFocus
                    value={commentInput}
                    onChange={(e) => setCommentInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitComment()
                      else if (e.key === 'Escape') cancelComment()
                    }}
                    placeholder={commentDraft.mode === 'add' ? 'New comment…' : 'Edit comment…'}
                    className="min-w-0 flex-1 rounded bg-surface px-2 py-1 text-sm text-ink outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    onClick={submitComment}
                    className="shrink-0 rounded bg-accent px-3 py-1 text-sm font-medium text-on-accent hover:bg-accent-hover"
                  >
                    {commentDraft.mode === 'add' ? 'Add' : 'Save'}
                  </button>
                  <button
                    onClick={cancelComment}
                    className="shrink-0 rounded px-2 py-1 text-sm text-ink-soft hover:bg-surface"
                  >
                    Cancel
                  </button>
                </div>
              )}
              {comments.map((c) => (
                <div key={c.id} className="flex items-start gap-2 px-4 py-2 text-sm">
                  <span
                    className="mt-1 h-3 w-3 shrink-0 rounded-full"
                    style={{ background: scrivColorToCss(c.color) }}
                  />
                  <button
                    onClick={() => selectAnchor(c.range)}
                    disabled={!c.range}
                    title={c.range ? 'Reveal the commented text' : undefined}
                    className="min-w-0 flex-1 text-left disabled:cursor-default"
                  >
                    {c.anchorText && (
                      <span className="block truncate text-xs italic text-accent">
                        “{c.anchorText}”
                      </span>
                    )}
                    <span className="block whitespace-pre-wrap break-words text-ink-soft">
                      {c.text || '(empty)'}
                    </span>
                  </button>
                  <button
                    onClick={() => startEditComment(c.id, c.text)}
                    className="shrink-0 text-xs text-ink-faint hover:text-accent"
                  >
                    Edit
                  </button>
                  <button
                    aria-label="Delete comment"
                    onClick={() => onDeleteComment(c.id)}
                    className="shrink-0 text-xs text-ink-faint hover:text-red-400"
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="border-t border-edge px-4 py-1.5 text-xs text-ink-faint">
            Plain-text editing: formatting outside your edits is preserved byte-for-byte;
            select text and hit Comment to annotate.
          </p>
        </>
      )}
    </div>
  )
}
