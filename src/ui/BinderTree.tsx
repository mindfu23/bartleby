import { useState } from 'react'
import type { BinderNode, MovePosition } from '../app/session'

interface Props {
  roots: BinderNode[]
  selected: string | null
  isDirty: (uuid: string) => boolean
  onSelect: (node: BinderNode) => void
  onMove: (dragUuid: string, refUuid: string, position: MovePosition) => void
}

const FOLDER_TYPES = new Set([
  'DraftFolder', 'Folder', 'ResearchFolder', 'TrashFolder', 'SearchFolder',
])
// Top-level special containers stay put — Scrivener requires Draft/Research/Trash.
const FIXED_ROOT_TYPES = new Set(['DraftFolder', 'ResearchFolder', 'TrashFolder'])

export function isFolderType(type: string): boolean {
  return FOLDER_TYPES.has(type)
}

/** Top-level containers Scrivener requires — can't be moved or trashed. */
export function isFixedRoot(type: string): boolean {
  return FIXED_ROOT_TYPES.has(type)
}

interface DropTarget {
  uuid: string
  position: MovePosition
}

interface Dnd {
  dragging: string | null
  dropTarget: DropTarget | null
  setDragging: (uuid: string | null) => void
  setDropTarget: (t: DropTarget | null) => void
  onMove: Props['onMove']
  end: () => void
}

function dropPositionAt(e: React.DragEvent, folder: boolean): MovePosition {
  const rect = e.currentTarget.getBoundingClientRect()
  const y = e.clientY - rect.top
  const h = rect.height
  if (folder) return y < h * 0.25 ? 'before' : y > h * 0.75 ? 'after' : 'inside'
  return y < h / 2 ? 'before' : 'after'
}

function NodeRow({
  node, depth, selected, isDirty, onSelect, dnd,
}: {
  node: BinderNode
  depth: number
  selected: string | null
  isDirty: (uuid: string) => boolean
  onSelect: (node: BinderNode) => void
  dnd: Dnd
}) {
  const [open, setOpen] = useState(depth < 2)
  const folder = isFolderType(node.type)
  const hasKids = node.children.length > 0
  const isSelected = selected === node.uuid
  const draggable = depth > 0 || !FIXED_ROOT_TYPES.has(node.type)
  const drop = dnd.dropTarget?.uuid === node.uuid ? dnd.dropTarget.position : null

  return (
    <div>
      <div
        draggable={draggable}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', node.uuid)
          dnd.setDragging(node.uuid)
        }}
        onDragEnd={dnd.end}
        onDragOver={(e) => {
          if (!dnd.dragging || dnd.dragging === node.uuid) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          dnd.setDropTarget({ uuid: node.uuid, position: dropPositionAt(e, folder) })
        }}
        onDrop={(e) => {
          e.preventDefault()
          const drag = dnd.dragging
          if (drag && drag !== node.uuid) dnd.onMove(drag, node.uuid, dropPositionAt(e, folder))
          dnd.end()
        }}
        className={`relative flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-sm ${
          isSelected ? 'bg-accent-soft text-accent' : 'text-ink-soft hover:bg-surface'
        } ${dnd.dragging === node.uuid ? 'opacity-40' : ''} ${
          drop === 'inside' ? 'bg-accent-soft ring-1 ring-accent' : ''
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => onSelect(node)}
      >
        {drop === 'before' && (
          <span className="pointer-events-none absolute inset-x-1 top-0 h-0.5 rounded bg-accent" />
        )}
        {drop === 'after' && (
          <span className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 rounded bg-accent" />
        )}
        <button
          aria-label={open ? 'Collapse' : 'Expand'}
          className={`w-4 shrink-0 text-ink-faint ${hasKids ? '' : 'invisible'}`}
          onClick={(e) => {
            e.stopPropagation()
            setOpen(!open)
          }}
        >
          {open ? '▾' : '▸'}
        </button>
        <span className="shrink-0">{folder ? '📁' : '📄'}</span>
        <span className="truncate">{node.title || '(untitled)'}</span>
        {isDirty(node.uuid) && <span className="ml-auto shrink-0 text-accent">●</span>}
      </div>
      {open &&
        node.children.map((child) => (
          <NodeRow
            key={child.uuid}
            node={child}
            depth={depth + 1}
            selected={selected}
            isDirty={isDirty}
            onSelect={onSelect}
            dnd={dnd}
          />
        ))}
    </div>
  )
}

export default function BinderTree({ roots, selected, isDirty, onSelect, onMove }: Props) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const dnd: Dnd = {
    dragging,
    dropTarget,
    setDragging,
    setDropTarget,
    onMove,
    end: () => {
      setDragging(null)
      setDropTarget(null)
    },
  }

  return (
    <nav className="h-full overflow-y-auto p-2" onDragEnd={dnd.end}>
      {roots.map((node) => (
        <NodeRow
          key={node.uuid}
          node={node}
          depth={0}
          selected={selected}
          isDirty={isDirty}
          onSelect={onSelect}
          dnd={dnd}
        />
      ))}
    </nav>
  )
}
