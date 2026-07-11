/**
 * Synchronous SHA-1 over raw bytes → lowercase hex.
 *
 * Kept dependency-free and synchronous (no SubtleCrypto, which is async) so
 * project export stays synchronous through the app layer. Used to regenerate
 * Scrivener's `docs.checksum` file, whose entries are SHA-1 hex digests of each
 * `content.rtf` / `notes.rtf`.
 */
export function sha1Hex(bytes: Uint8Array): string {
  const ml = bytes.length
  const bitLen = ml * 8
  // Pad: append 0x80, then zeros, then the 64-bit big-endian bit length, so the
  // total is a multiple of 64 bytes.
  const withOne = ml + 1
  const k = (56 - (withOne % 64) + 64) % 64
  const total = withOne + k + 8
  const msg = new Uint8Array(total)
  msg.set(bytes)
  msg[ml] = 0x80
  const dv = new DataView(msg.buffer)
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000))
  dv.setUint32(total - 4, bitLen >>> 0)

  let h0 = 0x67452301,
    h1 = 0xefcdab89,
    h2 = 0x98badcfe,
    h3 = 0x10325476,
    h4 = 0xc3d2e1f0

  const w = new Uint32Array(80)
  for (let i = 0; i < total; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4)
    for (let j = 16; j < 80; j++) {
      const n = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16]
      w[j] = (n << 1) | (n >>> 31)
    }

    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4
    for (let j = 0; j < 80; j++) {
      let f: number, kk: number
      if (j < 20) {
        f = (b & c) | (~b & d)
        kk = 0x5a827999
      } else if (j < 40) {
        f = b ^ c ^ d
        kk = 0x6ed9eba1
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d)
        kk = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        kk = 0xca62c1d6
      }
      const t = (((a << 5) | (a >>> 27)) + f + e + kk + w[j]) >>> 0
      e = d
      d = c
      c = (b << 30) | (b >>> 2)
      b = a
      a = t
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4)
}
