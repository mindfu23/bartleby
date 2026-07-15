import { describe, it, expect } from 'vitest'
import {
  apiArg,
  projectKey,
  bartlebyCopyPath,
  conflictCopyPath,
  backupCopyPath,
  hashesEqual,
  uploadRank,
} from '../dropboxio'

describe('dropboxio helpers', () => {
  it('apiArg escapes non-ASCII for the (ASCII-only) Dropbox-API-Arg header', () => {
    expect(apiArg({ path: '/x/y' })).toBe('{"path":"/x/y"}')
    expect(apiArg({ path: '/ebooks/café.scriv' })).toBe('{"path":"/ebooks/caf\\u00e9.scriv"}')
  })

  it('sibling paths for copy / conflict / backup targets', () => {
    expect(bartlebyCopyPath('/e/foo.scriv')).toBe('/e/foo-bartleby.scriv')
    expect(conflictCopyPath('/e/foo.scriv')).toBe('/e/foo (Bartleby conflict).scriv')
    expect(backupCopyPath('/e/foo.scriv')).toBe('/e/foo (Bartleby backup).scriv')
  })

  it('hashesEqual detects any server-side change (conflict signal)', () => {
    const base = new Map([['/a', 'h1'], ['/b', 'h2']])
    expect(hashesEqual(base, new Map([['/a', 'h1'], ['/b', 'h2']]))).toBe(true)
    expect(hashesEqual(base, new Map([['/a', 'h1'], ['/b', 'CHANGED']]))).toBe(false)
    expect(hashesEqual(base, new Map([['/a', 'h1']]))).toBe(false) // file removed
    expect(hashesEqual(base, new Map([...base, ['/c', 'h3']]))).toBe(false) // file added
  })

  it('uploadRank orders content first, .scrivx next, docs.checksum last', () => {
    const files = ['Files/Data/x/content.rtf', 'My.scrivx', 'Files/Data/docs.checksum']
    const ordered = [...files].sort((a, b) => uploadRank(a) - uploadRank(b))
    expect(ordered).toEqual([
      'Files/Data/x/content.rtf',
      'My.scrivx',
      'Files/Data/docs.checksum',
    ])
  })

  it('projectKey keys a file relative to (and including) its .scriv folder', () => {
    const parent = '/ebooks/book'
    expect(projectKey(parent, '/ebooks/book/foo.scriv/foo.scrivx')).toBe('foo.scriv/foo.scrivx')
    expect(projectKey(parent, '/ebooks/book/foo.scriv/Files/Data/x/content.rtf')).toBe(
      'foo.scriv/Files/Data/x/content.rtf',
    )
  })

  it('bartlebyCopyPath makes a non-destructive sibling target', () => {
    expect(bartlebyCopyPath('/ebooks/book/foo.scriv')).toBe('/ebooks/book/foo-bartleby.scriv')
    expect(bartlebyCopyPath('/x/Hyperspace Radio.scriv')).toBe('/x/Hyperspace Radio-bartleby.scriv')
  })
})
