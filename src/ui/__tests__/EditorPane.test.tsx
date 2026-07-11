// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import EditorPane from '../EditorPane'
import type { BinderNode } from '../../app/session'

afterEach(cleanup)

function node(over: Partial<BinderNode> = {}): BinderNode {
  return {
    uuid: 'UUID-1',
    type: 'Text',
    title: 'Doc One',
    children: [],
    metaDataRaw: null,
    childrenInsertOffset: null,
    itemEndOffset: 0,
    indent: '',
    titleTextStart: null,
    titleTextEnd: null,
    openTagEnd: 0,
    blockStart: 0,
    blockEnd: 0,
    ...over,
  }
}

const noop = () => null

describe('EditorPane (render)', () => {
  it('shows the placeholder when nothing is selected', () => {
    render(<EditorPane node={null} text="" onSave={noop} onRename={noop} />)
    expect(screen.getByText(/select a document/i)).toBeTruthy()
  })

  it('does NOT crash switching from no-selection to a document (Rules-of-Hooks regression)', () => {
    // Regression guard: the placeholder render and the document render must call
    // the same hooks in the same order. When hooks lived after the `if (!node)`
    // early return, this rerender threw "Rendered more hooks than during the
    // previous render" and blanked the whole app.
    const { rerender } = render(
      <EditorPane node={null} text="" onSave={noop} onRename={noop} />,
    )
    expect(() =>
      rerender(<EditorPane node={node()} text="Body text." onSave={noop} onRename={noop} />),
    ).not.toThrow()

    expect((screen.getByLabelText('Document title') as HTMLInputElement).value).toBe('Doc One')
    expect(screen.getByDisplayValue('Body text.')).toBeTruthy()
  })

  it('renders a folder view (with editable title) without a textarea', () => {
    render(<EditorPane node={node({ type: 'Folder', title: 'Chapter 1' })} text="" onSave={noop} onRename={noop} />)
    expect((screen.getByLabelText('Document title') as HTMLInputElement).value).toBe('Chapter 1')
    expect(screen.getByText(/is a folder/i)).toBeTruthy()
    expect(screen.queryByPlaceholderText(/start typing/i)).toBeNull()
  })

  it('commits a title change through onRename on blur', () => {
    const onRename = vi.fn(() => null)
    render(<EditorPane node={node()} text="Body." onSave={noop} onRename={onRename} />)
    const title = screen.getByLabelText('Document title') as HTMLInputElement
    fireEvent.change(title, { target: { value: 'Renamed' } })
    fireEvent.blur(title)
    expect(onRename).toHaveBeenCalledWith('Renamed')
  })
})
