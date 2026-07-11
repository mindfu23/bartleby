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
 * Resolve the actual `.scriv` project directory from a picked folder.
 *
 * macOS treats `.scriv` as a *package*, so the OS folder picker won't let you
 * select it directly — but you CAN select its parent, and packages are ordinary
 * directories once traversed. So: if the picked folder is itself a project (has
 * a `.scrivx`), use it; otherwise find the single `.scriv` subfolder inside it.
 */
export async function resolveScrivRoot(
  dir: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle> {
  const entries: FileSystemHandle[] = []
  for await (const e of dir.values()) entries.push(e)

  if (entries.some((e) => e.kind === 'file' && e.name.toLowerCase().endsWith('.scrivx'))) {
    return dir // the picked folder IS the project (e.g. Windows, or picked directly)
  }
  const scrivDirs = entries.filter(
    (e): e is FileSystemDirectoryHandle =>
      e.kind === 'directory' && e.name.toLowerCase().endsWith('.scriv'),
  )
  if (scrivDirs.length === 1) return scrivDirs[0]
  if (scrivDirs.length > 1) {
    throw new Error(
      'That folder contains more than one .scriv project. Pick a folder holding just the one you want.',
    )
  }
  throw new Error(
    'No .scriv project found here. On macOS, pick the folder that CONTAINS your .scriv (not the .scriv itself).',
  )
}

/** Returns null when the user cancels the picker. */
export async function pickProjectDirectory(): Promise<DirectProject | null> {
  try {
    const picked = await window.showDirectoryPicker({ mode: 'readwrite' })
    const root = await resolveScrivRoot(picked)
    const files = new Map<string, Uint8Array>()
    await readDirRecursive(root, root.name + '/', files)
    return { handle: root, files }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    throw e
  }
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
