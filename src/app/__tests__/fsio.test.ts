import { describe, it, expect } from 'vitest'
import { resolveScrivRoot } from '../fsio'

// Minimal fake of FileSystemDirectoryHandle: just a name, kind, and children.
function fileH(name: string) {
  return { kind: 'file' as const, name }
}
function dirH(name: string, children: Array<{ kind: string; name: string }> = []) {
  return {
    kind: 'directory' as const,
    name,
    async *values() {
      for (const c of children) yield c
    },
  }
}
const resolve = (h: unknown) => resolveScrivRoot(h as FileSystemDirectoryHandle)

describe('resolveScrivRoot', () => {
  it('returns the picked folder when it is itself the project (.scrivx inside)', async () => {
    const proj = dirH('My.scriv', [fileH('My.scrivx'), dirH('Files')])
    expect((await resolve(proj)).name).toBe('My.scriv')
  })

  it('finds the .scriv subfolder when a parent folder is picked (macOS path)', async () => {
    const parent = dirH('Dropbox', [dirH('My.scriv', [fileH('My.scrivx')]), fileH('notes.txt')])
    expect((await resolve(parent)).name).toBe('My.scriv')
  })

  it('rejects a folder with multiple .scriv projects', async () => {
    const parent = dirH('Projects', [dirH('A.scriv', []), dirH('B.scriv', [])])
    await expect(resolve(parent)).rejects.toThrow(/more than one/)
  })

  it('rejects a folder with no project', async () => {
    const parent = dirH('Empty', [fileH('readme.md')])
    await expect(resolve(parent)).rejects.toThrow(/No \.scriv project/)
  })
})
