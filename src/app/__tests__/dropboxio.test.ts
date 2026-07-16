import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  apiArg,
  projectKey,
  bartlebyCopyPath,
  conflictCopyPath,
  backupCopyPath,
  hashesEqual,
  uploadRank,
  packageBaseName,
  listScrivProjects,
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

describe('packageBaseName', () => {
  it('strips the folder path and .scriv extension', () => {
    expect(packageBaseName('/ebooks/Hyperspace Radio/Novel-bartleby.scriv')).toBe('Novel-bartleby')
    expect(packageBaseName('/ebooks/Novel (Bartleby conflict).scriv')).toBe(
      'Novel (Bartleby conflict)',
    )
  })
})

/**
 * The listing used to be `list_folder recursive:true`, which enumerated every
 * file inside every project just to find folders by name — the cause of the
 * slow project list (2026-07-16).
 */
describe('listScrivProjects', () => {
  afterEach(() => vi.unstubAllGlobals())

  /** Fake Dropbox: a folder tree, recording which paths got listed. */
  const stubDropbox = (tree: Record<string, { name: string; folder: boolean }[]>) => {
    const listed: string[] = []
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      const body = JSON.parse(init.body)
      listed.push(body.path)
      const kids = tree[body.path] ?? []
      return {
        ok: true,
        json: async () => ({
          entries: kids.map((k) => ({
            '.tag': k.folder ? 'folder' : 'file',
            name: k.name,
            path_display: `${body.path}/${k.name}`,
          })),
          has_more: false,
        }),
      }
    })
    return listed
  }

  it('finds projects nested in ordinary folders, without opening the packages', async () => {
    const listed = stubDropbox({
      '/ebooks': [
        { name: 'Hyperspace Radio', folder: true },
        { name: 'notes.txt', folder: false },
      ],
      '/ebooks/Hyperspace Radio': [{ name: 'Novel.scriv', folder: true }],
      // If this ever gets listed, we've crawled inside a package.
      '/ebooks/Hyperspace Radio/Novel.scriv': [{ name: 'Files', folder: true }],
    })
    const found = await listScrivProjects('t', '/ebooks')
    expect(found.map((p) => p.name)).toEqual(['Novel.scriv'])
    expect(listed).not.toContain('/ebooks/Hyperspace Radio/Novel.scriv')
  })

  it('never asks Dropbox to recurse', async () => {
    let recursed = false
    vi.stubGlobal('fetch', async (_url: string, init: any) => {
      if (JSON.parse(init.body).recursive) recursed = true
      return { ok: true, json: async () => ({ entries: [], has_more: false }) }
    })
    await listScrivProjects('t', '/ebooks')
    expect(recursed).toBe(false)
  })
})
