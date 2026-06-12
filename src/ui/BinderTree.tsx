import { useState } from 'react'
import type { BinderNode } from '../app/session'

interface Props {
  roots: BinderNode[]
  selected: string | null
  isDirty: (uuid: string) => boolean
  onSelect: (node: BinderNode) => void
}

const FOLDER_TYPES = new Set([
  'DraftFolder', 'Folder', 'ResearchFolder', 'TrashFolder', 'SearchFolder',
])

export function isFolderType(type: string): boolean {
  return FOLDER_TYPES.has(type)
}

function NodeRow({
  node, depth, selected, isDirty, onSelect,
}: {
  node: BinderNode
  depth: number
  selected: string | null
  isDirty: (uuid: string) => boolean
  onSelect: (node: BinderNode) => void
}) {
  const [open, setOpen] = useState(depth < 2)
  const folder = isFolderType(node.type)
  const hasKids = node.children.length > 0
  const isSelected = selected === node.uuid

  return (
    <div>
      <div
        className={`flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-sm ${
          isSelected ? 'bg-amber-800/40 text-amber-100' : 'text-stone-300 hover:bg-stone-800'
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => onSelect(node)}
      >
        <button
          aria-label={open ? 'Collapse' : 'Expand'}
          className={`w-4 shrink-0 text-stone-500 ${hasKids ? '' : 'invisible'}`}
          onClick={(e) => {
            e.stopPropagation()
            setOpen(!open)
          }}
        >
          {open ? '▾' : '▸'}
        </button>
        <span className="shrink-0">{folder ? '📁' : '📄'}</span>
        <span className="truncate">{node.title || '(untitled)'}</span>
        {isDirty(node.uuid) && <span className="ml-auto shrink-0 text-amber-400">●</span>}
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
          />
        ))}
    </div>
  )
}

export default function BinderTree({ roots, selected, isDirty, onSelect }: Props) {
  return (
    <nav className="h-full overflow-y-auto p-2">
      {roots.map((node) => (
        <NodeRow
          key={node.uuid}
          node={node}
          depth={0}
          selected={selected}
          isDirty={isDirty}
          onSelect={onSelect}
        />
      ))}
    </nav>
  )
}
