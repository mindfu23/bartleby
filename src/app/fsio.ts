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

/** Returns null when the user cancels the picker. */
export async function pickProjectDirectory(): Promise<DirectProject | null> {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' })
    const files = new Map<string, Uint8Array>()
    await readDirRecursive(handle, handle.name + '/', files)
    return { handle, files }
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
