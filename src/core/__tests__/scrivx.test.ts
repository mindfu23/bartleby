import { describe, it, expect } from 'vitest'
import {
  parseScrivx,
  insertBinderItem,
  setBinderItemTitle,
  updateProjectMeta,
  findNode,
  scrivenerTimestamp,
  newScrivenerUuid,
} from '../scrivx'
import {
  SCRIVX,
  UUID_DRAFT,
  UUID_SCENE1,
  UUID_SCENE2,
  UUID_RESEARCH,
  UUID_TRASH,
} from './fixture'

describe('parseScrivx', () => {
  it('builds the binder tree with titles, types, and nesting', () => {
    const model = parseScrivx(SCRIVX)
    expect(model.roots.map((r) => r.type)).toEqual([
      'DraftFolder',
      'ResearchFolder',
      'TrashFolder',
    ])
    const draft = model.roots[0]
    expect(draft.uuid).toBe(UUID_DRAFT)
    expect(draft.title).toBe('Draft')
    expect(draft.children.map((c) => c.uuid)).toContain(UUID_SCENE1)
    expect(draft.children.map((c) => c.uuid)).toContain(UUID_SCENE2)
  })

  it('decodes XML entities in titles', () => {
    const model = parseScrivx(SCRIVX)
    const scene2 = findNode(model, UUID_SCENE2)
    expect(scene2?.title).toBe('Scene Two & Friends')
  })

  it('captures a Text item MetaData block for cloning', () => {
    const model = parseScrivx(SCRIVX)
    expect(model.textItemMetaDataRaw).toContain('<IncludeInCompile>Yes</IncludeInCompile>')
  })
})

describe('setBinderItemTitle', () => {
  it('renames a single item, leaving every other byte identical', () => {
    const model = parseScrivx(SCRIVX)
    const node = findNode(model, UUID_SCENE1)!
    const xml = setBinderItemTitle(SCRIVX, node, 'Scene One Revised')

    expect(parseScrivx(xml).roots[0].children[0].title).toBe('Scene One Revised')
    // sibling and folder titles untouched
    const reparsed = parseScrivx(xml)
    expect(reparsed.roots[0].title).toBe('Draft')
    expect(reparsed.roots[0].children[1].title).toBe('Scene Two & Friends')
    // exactly the old title text is what changed
    expect(xml).toContain('<Title>Scene One Revised</Title>')
    expect(SCRIVX.replace('Scene One', 'Scene One Revised')).toBe(xml)
  })

  it('XML-encodes special characters in the new title', () => {
    const model = parseScrivx(SCRIVX)
    const node = findNode(model, UUID_SCENE1)!
    const xml = setBinderItemTitle(SCRIVX, node, 'A < B & C > D')
    expect(xml).toContain('<Title>A &lt; B &amp; C &gt; D</Title>')
    // round-trips back to the literal text
    expect(parseScrivx(xml).roots[0].children[0].title).toBe('A < B & C > D')
  })

  it('renames an item whose current title already contains an entity', () => {
    const model = parseScrivx(SCRIVX)
    const node = findNode(model, UUID_SCENE2)!
    expect(node.title).toBe('Scene Two & Friends')
    const xml = setBinderItemTitle(SCRIVX, node, 'Renamed')
    expect(parseScrivx(xml).roots[0].children[1].title).toBe('Renamed')
    // the sibling that shares a prefix is not disturbed
    expect(parseScrivx(xml).roots[0].children[0].title).toBe('Scene One')
  })

  it('renames a folder', () => {
    const model = parseScrivx(SCRIVX)
    const node = findNode(model, UUID_RESEARCH)!
    const xml = setBinderItemTitle(SCRIVX, node, 'Reference')
    expect(findNode(parseScrivx(xml), UUID_RESEARCH)!.title).toBe('Reference')
  })

  it('inserts a <Title> for an item that has none', () => {
    const noTitle =
      '<ScrivenerProject><Binder>' +
      '<BinderItem UUID="99999999-9999-9999-9999-999999999999" Type="Text"><MetaData/></BinderItem>' +
      '</Binder></ScrivenerProject>'
    const model = parseScrivx(noTitle)
    const node = findNode(model, '99999999-9999-9999-9999-999999999999')!
    expect(node.title).toBe('')
    const xml = setBinderItemTitle(noTitle, node, 'Now Named')
    expect(xml).toContain('<Title>Now Named</Title>')
    expect(findNode(parseScrivx(xml), '99999999-9999-9999-9999-999999999999')!.title).toBe(
      'Now Named',
    )
  })
})

describe('insertBinderItem', () => {
  it('inserts under a parent that already has <Children>', () => {
    const model = parseScrivx(SCRIVX)
    const { xml, uuid } = insertBinderItem(SCRIVX, model, UUID_DRAFT, 'Spike Test')
    const reparsed = parseScrivx(xml)
    const draft = findNode(reparsed, UUID_DRAFT)!
    const added = draft.children.find((c) => c.uuid === uuid)
    expect(added).toBeDefined()
    expect(added!.title).toBe('Spike Test')
    expect(added!.type).toBe('Text')
    // everything before the insertion point is byte-identical
    const insertAt = model.roots[0].childrenInsertOffset!
    expect(xml.slice(0, insertAt)).toBe(SCRIVX.slice(0, insertAt))
  })

  it('creates a <Children> wrapper when the parent has none', () => {
    const model = parseScrivx(SCRIVX)
    const { xml, uuid } = insertBinderItem(SCRIVX, model, UUID_RESEARCH, 'Notes')
    const reparsed = parseScrivx(xml)
    const research = findNode(reparsed, UUID_RESEARCH)!
    expect(research.children.map((c) => c.uuid)).toContain(uuid)
  })

  it('inserts at the binder root when parent is null', () => {
    const model = parseScrivx(SCRIVX)
    const { xml, uuid } = insertBinderItem(SCRIVX, model, null, 'Loose Doc')
    const reparsed = parseScrivx(xml)
    expect(reparsed.roots.map((r) => r.uuid)).toContain(uuid)
    // existing roots intact
    expect(reparsed.roots.map((r) => r.uuid)).toContain(UUID_TRASH)
  })

  it('escapes XML specials in titles', () => {
    const model = parseScrivx(SCRIVX)
    const { xml, uuid } = insertBinderItem(SCRIVX, model, UUID_DRAFT, 'Cats & <Dogs>')
    const reparsed = parseScrivx(xml)
    expect(findNode(reparsed, uuid)?.title).toBe('Cats & <Dogs>')
  })

  it('rejects unknown parent UUIDs', () => {
    const model = parseScrivx(SCRIVX)
    expect(() =>
      insertBinderItem(SCRIVX, model, 'DEADBEEF-0000-0000-0000-000000000000', 'X'),
    ).toThrow()
  })
})

describe('updateProjectMeta', () => {
  it('freshens Modified and ModID on the root element only', () => {
    const out = updateProjectMeta(SCRIVX, new Date(2026, 5, 12, 10, 30, 0))
    expect(out).not.toContain('ModID="B4A944C3-1111-2222-3333-444444444444"')
    expect(out).toContain('Modified="2026-06-12 10:30:00 ')
    // item-level Modified attributes untouched
    expect(out).toContain('Modified="2025-03-14 22:15:20 -0600"')
  })
})

describe('helpers', () => {
  it('formats Scrivener timestamps', () => {
    const ts = scrivenerTimestamp(new Date(2026, 0, 5, 9, 8, 7))
    expect(ts).toMatch(/^2026-01-05 09:08:07 [+-]\d{4}$/)
  })
  it('generates uppercase hyphenated UUIDs', () => {
    expect(newScrivenerUuid()).toMatch(
      /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/,
    )
  })
})
