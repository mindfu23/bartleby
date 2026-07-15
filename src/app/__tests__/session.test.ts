import { describe, it, expect } from 'vitest'
import { ProjectSession } from '../session'
import { sha1Hex } from '../../core/sha1'
import {
  fixtureFiles,
  SCENE1_TEXT,
  SCENE2_TEXT,
  UUID_SCENE1,
  UUID_SCENE2,
  UUID_EMPTY,
  UUID_DRAFT,
  UUID_TRASH,
} from '../../core/__tests__/fixture'

describe('ProjectSession', () => {
  it('opens a project with a .scriv root prefix and reads documents', () => {
    const s = ProjectSession.open(fixtureFiles())
    expect(s.projectName).toBe('Baseline')
    expect(s.binderTree().length).toBe(3)
    expect(s.readDoc(UUID_SCENE1)).toBe(SCENE1_TEXT)
    expect(s.readDoc(UUID_SCENE2)).toBe(SCENE2_TEXT)
  })

  it('opens a project without a root prefix (zipped contents directly)', () => {
    const s = ProjectSession.open(fixtureFiles(''))
    expect(s.projectName).toBe('Baseline')
    expect(s.readDoc(UUID_SCENE1)).toBe(SCENE1_TEXT)
  })

  it('rejects non-Scrivener selections with a clear error', () => {
    const files = new Map([['readme.txt', new Uint8Array([65])]])
    expect(() => ProjectSession.open(files)).toThrow(/No \.scrivx/)
  })

  it('applies edits and tracks dirty state', () => {
    const s = ProjectSession.open(fixtureFiles())
    expect(s.isDirty()).toBe(false)
    s.applyEdit(UUID_SCENE1, SCENE1_TEXT.replace('world', 'there'))
    expect(s.isDirty(UUID_SCENE1)).toBe(true)
    expect(s.readDoc(UUID_SCENE1)).toBe(SCENE1_TEXT.replace('world', 'there'))
    // other doc untouched
    expect(s.isDirty(UUID_SCENE2)).toBe(false)
  })

  it('creates a content.rtf for a binder item that has none', () => {
    const s = ProjectSession.open(fixtureFiles())
    expect(s.readDoc(UUID_EMPTY)).toBe('')
    s.applyEdit(UUID_EMPTY, 'Now it has text.')
    expect(s.readDoc(UUID_EMPTY)).toBe('Now it has text.')
    expect(s.hasDocFile(UUID_EMPTY)).toBe(true)
  })

  it('adds a new document under a folder', () => {
    const s = ProjectSession.open(fixtureFiles())
    const uuid = s.addDocument(UUID_DRAFT, 'Spike Test', 'Hello from headless.')
    expect(s.readDoc(uuid)).toBe('Hello from headless.')
    const draft = s.binderTree().find((n) => n.uuid === UUID_DRAFT)!
    expect(draft.children.some((c) => c.uuid === uuid)).toBe(true)
  })

  it('export strips unrebuildable caches, regenerates docs.checksum, and leaves untouched docs byte-identical', () => {
    const input = fixtureFiles()
    const s = ProjectSession.open(input)
    s.applyEdit(UUID_SCENE1, SCENE1_TEXT.replace('world', 'there'))
    const out = s.exportFiles()

    // Unrebuildable caches stripped; docs.checksum regenerated (not stripped).
    expect(out.has('Files/search.indexes')).toBe(false)
    expect(out.has('Files/binder.autosave')).toBe(false)
    expect(out.has('Files/binder.backup')).toBe(false)
    expect(out.has('version.txt')).toBe(true)

    const checksum = new TextDecoder().decode(out.get('Files/Data/docs.checksum')!)
    expect(checksum).not.toBe('fake-checksum')
    expect(checksum.split('\n')).toHaveLength(2)
    expect(checksum.endsWith('\n')).toBe(false)
    // The regenerated hash must match the exact bytes export emits for that doc
    // (post-edit) — not the input, not a stale value.
    const outScene1 = out.get(`Files/Data/${UUID_SCENE1}/content.rtf`)!
    expect(checksum).toContain(
      `${UUID_SCENE1.toLowerCase()}/content.rtf=${sha1Hex(outScene1)}`,
    )

    const scrivx = new TextDecoder().decode(out.get('Baseline.scrivx')!)
    expect(scrivx).not.toContain('ModID="B4A944C3-1111-2222-3333-444444444444"')

    // untouched document byte-identical to input
    const inScene2 = input.get(`Baseline.scriv/Files/Data/${UUID_SCENE2}/content.rtf`)!
    const outScene2 = out.get(`Files/Data/${UUID_SCENE2}/content.rtf`)!
    expect(Array.from(outScene2)).toEqual(Array.from(inScene2))

    // input map never mutated for untouched paths
    expect(new TextDecoder().decode(input.get('Baseline.scriv/Files/Data/docs.checksum')!)).toBe(
      'fake-checksum',
    )
  })

  it('exportDelta returns only changed files plus scrivx, and cache deletions', () => {
    const s = ProjectSession.open(fixtureFiles())
    // nothing dirty: a save would be a no-op
    expect(s.exportDelta().writes.size).toBe(0)
    expect(s.exportDelta().deletes).toEqual([])

    s.applyEdit(UUID_SCENE1, SCENE1_TEXT.replace('world', 'there'))
    const { writes, deletes } = s.exportDelta()
    // Changed doc + freshened scrivx + regenerated docs.checksum.
    expect([...writes.keys()].sort()).toEqual(
      [
        'Baseline.scrivx',
        'Files/Data/docs.checksum',
        `Files/Data/${UUID_SCENE1}/content.rtf`,
      ].sort(),
    )
    const scrivx = new TextDecoder().decode(writes.get('Baseline.scrivx')!)
    expect(scrivx).not.toContain('ModID="B4A944C3-1111-2222-3333-444444444444"')
    // docs.checksum is written (regenerated), not deleted; the unrebuildable
    // caches are deleted.
    expect(deletes).not.toContain('Files/Data/docs.checksum')
    expect(deletes).toContain('Files/search.indexes')
    expect(deletes).toContain('Files/binder.autosave')

    s.markSaved()
    expect(s.isDirty()).toBe(false)
    expect(s.exportDelta().writes.size).toBe(0)
    expect(s.exportDelta().deletes).toEqual([])
  })

  it('renames a document, marks dirty, and persists the new title through export', () => {
    const s = ProjectSession.open(fixtureFiles())
    expect(s.isDirty()).toBe(false)
    s.renameItem(UUID_SCENE1, 'Chapter One')
    expect(s.isDirty()).toBe(true)

    // reflected in the live binder tree
    const draft = s.binderTree().find((n) => n.uuid === UUID_DRAFT)!
    expect(draft.children.find((n) => n.uuid === UUID_SCENE1)!.title).toBe('Chapter One')

    // and in the exported .scrivx
    const out = s.exportFiles()
    const scrivx = new TextDecoder().decode(out.get('Baseline.scrivx')!)
    expect(scrivx).toContain('<Title>Chapter One</Title>')
    expect(scrivx).not.toContain('<Title>Scene One</Title>')
  })

  it('serialize/deserialize restores edits, renames, and dirty state', () => {
    const s = ProjectSession.open(fixtureFiles())
    s.applyEdit(UUID_SCENE1, SCENE1_TEXT.replace('world', 'there'))
    s.renameItem(UUID_SCENE2, 'Renamed Scene')

    const restored = ProjectSession.deserialize(s.serialize())

    // content edit survived
    expect(restored.readDoc(UUID_SCENE1)).toContain('there')
    // rename survived (live scrivx captured in the snapshot)
    const draft = restored.binderTree().find((n) => n.uuid === UUID_DRAFT)!
    expect(draft.children.find((n) => n.uuid === UUID_SCENE2)!.title).toBe('Renamed Scene')
    // dirty tracking survived
    expect(restored.isDirty()).toBe(true)
    expect(restored.isDirty(UUID_SCENE1)).toBe(true)
    // and it still exports a consistent project
    const out = restored.exportFiles()
    expect(out.has('Files/Data/docs.checksum')).toBe(true)
  })

  it('renames a folder', () => {
    const s = ProjectSession.open(fixtureFiles())
    s.renameItem(UUID_DRAFT, 'Manuscript')
    expect(s.binderTree().find((n) => n.uuid === UUID_DRAFT)!.title).toBe('Manuscript')
  })

  it('moves an item into a folder, marks dirty, and persists through export', () => {
    const s = ProjectSession.open(fixtureFiles())
    s.moveItem(UUID_SCENE1, UUID_DRAFT, 'inside') // already inside Draft, but re-nests cleanly
    expect(s.isDirty()).toBe(true)
    // reparent Scene One out under the binder root (after Draft)
    s.moveItem(UUID_SCENE1, UUID_DRAFT, 'after')
    expect(s.binderTree().map((n) => n.uuid)).toContain(UUID_SCENE1)
    const out = s.exportFiles()
    expect(out.has('Baseline.scrivx')).toBe(true)
  })

  it('adds, lists, edits, and deletes a comment without altering the text', () => {
    const s = ProjectSession.open(fixtureFiles())
    const proj = s.readDoc(UUID_SCENE1)
    const start = proj.indexOf('world')
    expect(start).toBeGreaterThanOrEqual(0)

    const id = s.addComment(UUID_SCENE1, start, start + 'world'.length, 'check this')
    expect(s.readDoc(UUID_SCENE1)).toBe(proj) // visible text unchanged
    expect(s.isDirty(UUID_SCENE1)).toBe(true)

    let comments = s.getComments(UUID_SCENE1)
    expect(comments).toHaveLength(1)
    expect(comments[0].id).toBe(id)
    expect(comments[0].text).toBe('check this')
    // the anchor maps back to exactly the commented word
    expect(comments[0].anchorText).toBe('world')
    expect(comments[0].range).toEqual({ start, end: start + 'world'.length })

    // the anchor and sidecar are present in the export
    const out = s.exportFiles()
    const rtf = String.fromCharCode(...out.get(`Files/Data/${UUID_SCENE1}/content.rtf`)!)
    expect(rtf).toContain(`scrivcmt://${id}`)
    expect(out.has(`Files/Data/${UUID_SCENE1}/content.comments`)).toBe(true)

    s.editComment(UUID_SCENE1, id, 'checked')
    expect(s.getComments(UUID_SCENE1)[0].text).toBe('checked')

    s.deleteComment(UUID_SCENE1, id)
    expect(s.getComments(UUID_SCENE1)).toHaveLength(0)
    expect(s.readDoc(UUID_SCENE1)).toBe(proj) // text restored after unlink
    expect(s.exportFiles().has(`Files/Data/${UUID_SCENE1}/content.comments`)).toBe(false)
  })

  it('moveToTrash relocates an item into the Trash folder', () => {
    const s = ProjectSession.open(fixtureFiles())
    s.moveToTrash(UUID_SCENE1)
    const trash = s.binderTree().find((n) => n.uuid === UUID_TRASH)!
    expect(trash.children.map((n) => n.uuid)).toContain(UUID_SCENE1)
    expect(s.binderTree().find((n) => n.uuid === UUID_DRAFT)!.children.map((n) => n.uuid)).not.toContain(
      UUID_SCENE1,
    )
    expect(s.isDirty()).toBe(true)
  })

  it('rejects renaming a nonexistent item', () => {
    const s = ProjectSession.open(fixtureFiles())
    expect(() => s.renameItem('00000000-0000-0000-0000-000000000000', 'X')).toThrow(/No binder/)
  })

  it('exportOriginalFiles returns pre-edit bytes for the backup', () => {
    const s = ProjectSession.open(fixtureFiles())
    s.applyEdit(UUID_SCENE1, SCENE1_TEXT.replace('world', 'there'))
    const original = s.exportOriginalFiles()
    const origRtf = original.get(`Files/Data/${UUID_SCENE1}/content.rtf`)!
    const origText = String.fromCharCode(...origRtf)
    expect(origText).toContain('Hello world')
    expect(origText).not.toContain('Hello there')
    expect(original.has('Files/Data/docs.checksum')).toBe(true)
  })

  it('round-trips an édited document with accents through export', () => {
    const s = ProjectSession.open(fixtureFiles())
    s.applyEdit(UUID_SCENE2, 'Una niña soñó. Ünd über alles.\n')
    expect(s.readDoc(UUID_SCENE2)).toBe('Una niña soñó. Ünd über alles.\n')
  })
})
