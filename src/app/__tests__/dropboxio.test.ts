import { describe, it, expect } from 'vitest'
import { apiArg, projectKey, bartlebyCopyPath } from '../dropboxio'

describe('dropboxio helpers', () => {
  it('apiArg escapes non-ASCII for the (ASCII-only) Dropbox-API-Arg header', () => {
    expect(apiArg({ path: '/x/y' })).toBe('{"path":"/x/y"}')
    expect(apiArg({ path: '/ebooks/café.scriv' })).toBe('{"path":"/ebooks/caf\\u00e9.scriv"}')
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
