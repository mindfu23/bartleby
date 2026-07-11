/**
 * File System Access API I/O (Chrome/Edge desktop): open a .scriv folder
 * with readwrite permission and save changed files directly back into it.
 * Browsers without the API (Firefox, Safari, mobile) use zipio.ts instead.
 */

export function supportsDirectAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

async function readDirRecursive(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  files: Map<string, Uint8Array>,
): Promise<void> {
  for await (const entry of dir.values()) {
    if (entry.name.startsWith('.')) continue
    if (entry.kind === 'file') {
      const file = await entry.getFile()
      files.set(prefix + entry.name, new Uint8Array(await file.arrayBuffer()))
    } else {
      await readDirRecursive(entry, prefix + entry.name + '/', files)
    }
  }
}

export interface DirectProject {
  handle: FileSystemDirectoryHandle
  files: Map<string, Uint8Array>
}

/**
 * Find the `.scriv` project(s) in a picked folder.
 *
 * macOS treats `.scriv` as a *package*, so the OS folder picker won't let you
 * select it directly (it grays out) — but you CAN select the folder that
 * contains it, and packages are ordinary directories once traversed. If the
 * picked folder is itself a project (has a `.scrivx`), it's the sole candidate;
 * otherwise every `.scriv` subfolder is a candidate for the user to choose from.
 */
export function findScrivProjects(
  self: FileSystemDirectoryHandle,
  entries: FileSystemHandle[],
): FileSystemDirectoryHandle[] {
  if (entries.some((e) => e.kind === 'file' && e.name.toLowerCase().endsWith('.scrivx'))) {
    return [self]
  }
  return entries
    .filter(
      (e): e is FileSystemDirectoryHandle =>
        e.kind === 'directory' && e.name.toLowerCase().endsWith('.scriv'),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Read a `.scriv` directory handle into a root-prefixed path→bytes map. */
export async function readProject(handle: FileSystemDirectoryHandle): Promise<DirectProject> {
  const files = new Map<string, Uint8Array>()
  await readDirRecursive(handle, handle.name + '/', files)
  return { handle, files }
}

export type PickResult =
  | { kind: 'project'; project: DirectProject }
  | { kind: 'choose'; candidates: FileSystemDirectoryHandle[] }

/**
 * Pick a folder and resolve it to a project. One project → opened directly;
 * several → returned for the caller to present a chooser. Null on cancel.
 */
export async function pickProjectDirectory(): Promise<PickResult | null> {
  let picked: FileSystemDirectoryHandle
  try {
    picked = await window.showDirectoryPicker({ mode: 'readwrite' })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    throw e
  }
  const entries: FileSystemHandle[] = []
  for await (const e of picked.values()) entries.push(e)

  const candidates = findScrivProjects(picked, entries)
  if (candidates.length === 0) {
    throw new Error(
      'No .scriv project found here. Pick a folder that contains your Scrivener project(s).',
    )
  }
  if (candidates.length === 1) {
    return { kind: 'project', project: await readProject(candidates[0]) }
  }
  return { kind: 'choose', candidates }
}

/** Write changed files into the project folder and remove stripped caches. */
export async function writeProjectDelta(
  root: FileSystemDirectoryHandle,
  writes: Map<string, Uint8Array>,
  deletes: string[],
): Promise<void> {
  for (const [path, bytes] of writes) {
    const segs = path.split('/')
    let dir = root
    for (const seg of segs.slice(0, -1)) {
      dir = await dir.getDirectoryHandle(seg, { create: true })
    }
    const fh = await dir.getFileHandle(segs[segs.length - 1], { create: true })
    const w = await fh.createWritable()
    await w.write(bytes)
    await w.close()
  }
  for (const path of deletes) {
    try {
      const segs = path.split('/')
      let dir = root
      for (const seg of segs.slice(0, -1)) {
        dir = await dir.getDirectoryHandle(seg)
      }
      await dir.removeEntry(segs[segs.length - 1])
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') continue
      throw e
    }
  }
}
