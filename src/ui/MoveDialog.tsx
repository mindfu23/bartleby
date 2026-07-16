import { useState } from 'react'
import type { BinderNode } from '../app/session'
import { isFolderType } from './BinderTree'

interface Props {
  roots: BinderNode[]
  /** the item being moved */
  node: BinderNode
  onMove: (destFolderUuid: string | null, position: 'top' | 'bottom') => string | null
  onClose: () => void
}

/** uuids of `node` and everything under it — invalid move destinations. */
function subtreeUuids(node: BinderNode): Set<string> {
  const set = new Set<string>()
  const walk = (n: BinderNode) => {
    set.add(n.uuid)
    n.children.forEach(walk)
  }
  walk(node)
  return set
}

function folderOptions(
  nodes: BinderNode[],
  exclude: Set<string>,
  depth = 0,
): { uuid: string; label: string }[] {
  const out: { uuid: string; label: string }[] = []
  for (const n of nodes) {
    if (!isFolderType(n.type)) continue
    if (!exclude.has(n.uuid)) {
      out.push({ uuid: n.uuid, label: `${' '.repeat(depth * 3)}${n.title || '(untitled)'}` })
    }
    out.push(...folderOptions(n.children, exclude, depth + 1))
  }
  return out
}

export default function MoveDialog({ roots, node, onMove, onClose }: Props) {
  const [dest, setDest] = useState<string>('')
  const [position, setPosition] = useState<'top' | 'bottom'>('bottom')
  const [error, setError] = useState<string | null>(null)

  const folders = folderOptions(roots, subtreeUuids(node))

  const submit = () => {
    const err = onMove(dest || null, position)
    if (err) setError(err)
    else onClose()
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-edge bg-canvas p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-medium text-ink">
          Move <span className="text-accent">{node.title || '(untitled)'}</span>
        </h3>
        <label className="mt-4 block text-sm text-ink-soft">
          Into
          <select
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            className="mt-1 w-full rounded border border-edge bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
          >
            <option value="">Binder root</option>
            {folders.map((f) => (
              <option key={f.uuid} value={f.uuid}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="mt-3 flex gap-4 text-sm text-ink-soft">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={position === 'top'} onChange={() => setPosition('top')} /> Top
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={position === 'bottom'}
              onChange={() => setPosition('bottom')}
            />{' '}
            Bottom
          </label>
        </fieldset>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded px-4 py-2 text-sm text-ink-soft hover:bg-surface">
            Cancel
          </button>
          <button
            onClick={submit}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-on-accent hover:bg-accent-hover"
          >
            Move
          </button>
        </div>
      </div>
    </div>
  )
}
