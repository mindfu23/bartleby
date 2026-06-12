/**
 * Byte-exact string conversion. RTF files are treated as a sequence of bytes;
 * we map each byte to one JS char (0x00-0xFF) so string offsets ARE byte
 * offsets. This is true latin1 (identity), NOT windows-1252 decoding —
 * cp1252 interpretation happens only for \'hh escapes during projection.
 */
export function bytesToLatin1(bytes: Uint8Array): string {
  let s = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)))
  }
  return s
}

export function latin1ToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c > 0xff) {
      throw new Error(`latin1ToBytes: non-byte char U+${c.toString(16)} at offset ${i}`)
    }
    out[i] = c
  }
  return out
}
