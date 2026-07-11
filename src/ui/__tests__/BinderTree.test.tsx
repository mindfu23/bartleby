// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import BinderTree from '../BinderTree'
import type { BinderNode } from '../../app/session'

afterEach(cleanup)

function node(uuid: string, type: string, title: string, children: BinderNode[] = []): BinderNode {
  return {
    uuid, type, title, children,
    metaDataRaw: null, childrenInsertOffset: null, itemEndOffset: 0, indent: '',
    titleTextStart: null, titleTextEnd: null, openTagEnd: 0, blockStart: 0, blockEnd: 0,
  }
}

// Draft folder with two documents inside it.
const roots = [
  node('DRAFT', 'DraftFolder', 'Draft', [
    node('DOC-A', 'Text', 'Doc A'),
    node('DOC-B', 'Text', 'Doc B'),
  ]),
]

const mkDataTransfer = () => {
  const store: Record<string, string> = {}
  return {
    effectAllowed: '',
    dropEffect: '',
    setData: (k: string, v: string) => (store[k] = v),
    getData: (k: string) => store[k] ?? '',
  }
}

describe('BinderTree drag-and-drop', () => {
  it('fires onMove(drag, ref, position) when a doc is dropped on another', () => {
    const onMove = vi.fn()
    render(
      <BinderTree roots={roots} selected={null} isDirty={() => false} onSelect={() => {}} onMove={onMove} />,
    )
    const dragRow = screen.getByText('Doc A').closest('[draggable]')!
    const dropRow = screen.getByText('Doc B').closest('[draggable]')!
    const dataTransfer = mkDataTransfer()

    fireEvent.dragStart(dragRow, { dataTransfer })
    fireEvent.dragOver(dropRow, { dataTransfer, clientY: 5 })
    fireEvent.drop(dropRow, { dataTransfer, clientY: 5 })

    expect(onMove).toHaveBeenCalledTimes(1)
    expect(onMove.mock.calls[0][0]).toBe('DOC-A') // dragged
    expect(onMove.mock.calls[0][1]).toBe('DOC-B') // reference
    expect(['before', 'after', 'inside']).toContain(onMove.mock.calls[0][2])
  })

  it('does not fire onMove when dropping a row on itself', () => {
    const onMove = vi.fn()
    render(
      <BinderTree roots={roots} selected={null} isDirty={() => false} onSelect={() => {}} onMove={onMove} />,
    )
    const row = screen.getByText('Doc A').closest('[draggable]')!
    const dataTransfer = mkDataTransfer()
    fireEvent.dragStart(row, { dataTransfer })
    fireEvent.drop(row, { dataTransfer, clientY: 5 })
    expect(onMove).not.toHaveBeenCalled()
  })
})
