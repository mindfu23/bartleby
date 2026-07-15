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
const base = {
  text: '',
  comments: [],
  onSave: noop,
  onRename: noop,
  onAddComment: () => null,
  onEditComment: () => {},
  onDeleteComment: () => {},
  onMoveRequest: () => {},
  onTrash: () => {},
}

describe('EditorPane (render)', () => {
  it('shows the placeholder when nothing is selected', () => {
    render(<EditorPane {...base} node={null} />)
    expect(screen.getByText(/select a document/i)).toBeTruthy()
  })

  it('does NOT crash switching from no-selection to a document (Rules-of-Hooks regression)', () => {
    // Regression guard: the placeholder render and the document render must call
    // the same hooks in the same order. When hooks lived after the `if (!node)`
    // early return, this rerender threw "Rendered more hooks than during the
    // previous render" and blanked the whole app.
    const { rerender } = render(<EditorPane {...base} node={null} />)
    expect(() =>
      rerender(<EditorPane {...base} node={node()} text="Body text." />),
    ).not.toThrow()

    expect((screen.getByLabelText('Document title') as HTMLInputElement).value).toBe('Doc One')
    expect(screen.getByDisplayValue('Body text.')).toBeTruthy()
  })

  it('renders a folder view (with editable title) without a textarea', () => {
    render(<EditorPane {...base} node={node({ type: 'Folder', title: 'Chapter 1' })} />)
    expect((screen.getByLabelText('Document title') as HTMLInputElement).value).toBe('Chapter 1')
    expect(screen.getByText(/is a folder/i)).toBeTruthy()
    expect(screen.queryByPlaceholderText(/start typing/i)).toBeNull()
  })

  it('commits a title change through onRename on blur', () => {
    const onRename = vi.fn(() => null)
    render(<EditorPane {...base} node={node()} text="Body." onRename={onRename} />)
    const title = screen.getByLabelText('Document title') as HTMLInputElement
    fireEvent.change(title, { target: { value: 'Renamed' } })
    fireEvent.blur(title)
    expect(onRename).toHaveBeenCalledWith('Renamed')
  })

  it('lists a comment and deletes it', () => {
    const onDeleteComment = vi.fn()
    render(
      <EditorPane
        {...base}
        node={node()}
        text="Body."
        comments={[{ id: 'C1', color: '0.9 0.9 0.5', text: 'a note', range: null, anchorText: '' }]}
        onDeleteComment={onDeleteComment}
      />,
    )
    expect(screen.getByText('a note')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete comment' }))
    expect(onDeleteComment).toHaveBeenCalledWith('C1')
  })

  it('opens the inline composer and adds a comment (no window.prompt)', () => {
    const onAddComment = vi.fn(() => null)
    render(<EditorPane {...base} node={node()} text="Hello world." onAddComment={onAddComment} />)
    // simulate a selection, then click Comment
    const ta = screen.getByPlaceholderText(/start typing|Hello/i) as HTMLTextAreaElement
    ta.selectionStart = 0
    ta.selectionEnd = 5
    fireEvent.select(ta)
    fireEvent.click(screen.getByText('Comment'))
    const input = screen.getByPlaceholderText(/new comment/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'my note' } })
    fireEvent.click(screen.getByText('Add'))
    expect(onAddComment).toHaveBeenCalledWith(0, 5, 'my note')
  })
})
