/**
 * Zip import/export for the browser frontend. Kept out of session.ts so the
 * core + session layers stay dependency-free.
 */
import JSZip from 'jszip'

export async function importZip(data: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const zip = await JSZip.loadAsync(data)
  const files = new Map<string, Uint8Array>()
  const entries = Object.values(zip.files).filter((f) => !f.dir)
  for (const entry of entries) {
    // skip macOS resource-fork noise
    if (entry.name.startsWith('__MACOSX/') || entry.name.split('/').pop()?.startsWith('._')) {
      continue
    }
    files.set(entry.name, await entry.async('uint8array'))
  }
  return files
}

export async function exportZip(
  files: Map<string, Uint8Array>,
  rootName: string,
): Promise<Blob> {
  const zip = new JSZip()
  for (const [path, bytes] of files) {
    zip.file(`${rootName}/${path}`, bytes)
  }
  return zip.generateAsync({ type: 'blob' })
}

/** Read a folder-picker FileList (webkitdirectory) into a path→bytes map. */
export async function importFileList(list: FileList): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>()
  for (const file of Array.from(list)) {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    if (path.split('/').pop()?.startsWith('.')) continue
    files.set(path, new Uint8Array(await file.arrayBuffer()))
  }
  return files
}
