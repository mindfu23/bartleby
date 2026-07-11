import { describe, it, expect } from 'vitest'
import { findScrivProjects } from '../fsio'

// Minimal fakes of FileSystemHandle.
const fileH = (name: string) => ({ kind: 'file' as const, name })
const dirH = (name: string) => ({ kind: 'directory' as const, name })
const call = (self: unknown, entries: unknown[]) =>
  findScrivProjects(self as FileSystemDirectoryHandle, entries as FileSystemHandle[]).map(
    (h) => h.name,
  )

describe('findScrivProjects', () => {
  it('treats the picked folder as the project when it has a .scrivx', () => {
    const self = dirH('My.scriv')
    expect(call(self, [fileH('My.scrivx'), dirH('Files')])).toEqual(['My.scriv'])
  })

  it('returns the single .scriv subfolder (macOS parent-folder pick)', () => {
    expect(call(dirH('Dropbox'), [dirH('My.scriv'), fileH('notes.txt')])).toEqual(['My.scriv'])
  })

  it('returns all .scriv projects, sorted, for the user to choose', () => {
    const entries = [dirH('rewrite v2.scriv'), dirH('biz.scriv'), fileH('cover.png'), dirH('elohim.scriv')]
    expect(call(dirH('ebooks'), entries)).toEqual(['biz.scriv', 'elohim.scriv', 'rewrite v2.scriv'])
  })

  it('returns nothing when there is no project', () => {
    expect(call(dirH('Empty'), [fileH('readme.md')])).toEqual([])
  })
})
