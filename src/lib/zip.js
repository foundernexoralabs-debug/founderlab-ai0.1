// Dependency-free ZIP reader/writer using native CompressionStream/DecompressionStream.
// Writer uses STORE (no compression) for 100% reliability across all browsers/OSes.
// Reader supports STORE (method 0) and DEFLATE (method 8) via DecompressionStream.

function crc32(bytes) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      table[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function u16(n) { return new Uint8Array([n & 0xff, (n >> 8) & 0xff]) }
function u32(n) { return new Uint8Array([n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]) }
function concat(arrs) {
  const total = arrs.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const a of arrs) { out.set(a, o); o += a.length }
  return out
}
function dosTime() { return 0 } // fixed epoch — fine for generated files
function dosDate() { return 0x21 } // 1980-01-01, valid minimum

export const zipSupported = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'

// files: [{ path: 'src/index.js', content: string | Uint8Array }]
export async function createZip(files) {
  const enc = new TextEncoder()
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const f of files) {
    const nameBytes = enc.encode(f.path.replace(/^\/+/, ''))
    const data = typeof f.content === 'string' ? enc.encode(f.content) : f.content
    const crc = crc32(data)

    const localHeader = concat([
      u32(0x04034b50), u16(20), u16(0), u16(0),
      u16(dosTime()), u16(dosDate()),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0),
      nameBytes,
    ])
    localParts.push(localHeader, data)

    const centralHeader = concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0),
      u16(dosTime()), u16(dosDate()),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset),
      nameBytes,
    ])
    centralParts.push(centralHeader)
    offset += localHeader.length + data.length
  }

  const centralDir = concat(centralParts)
  const eocd = concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(files.length), u16(files.length),
    u32(centralDir.length), u32(offset),
    u16(0),
  ])

  return new Blob([concat(localParts), centralDir, eocd], { type: 'application/zip' })
}

// Returns [{ path, content: Uint8Array }]
export async function readZip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer)
  const dv = new DataView(arrayBuffer)
  const files = []

  // Find End Of Central Directory (search from the end for the signature)
  let eocdOffset = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdOffset = i; break }
  }
  if (eocdOffset === -1) throw new Error('Not a valid ZIP file')

  const entryCount = dv.getUint16(eocdOffset + 10, true)
  let centralOffset = dv.getUint32(eocdOffset + 16, true)

  for (let i = 0; i < entryCount; i++) {
    if (dv.getUint32(centralOffset, true) !== 0x02014b50) break
    const method = dv.getUint16(centralOffset + 10, true)
    const compSize = dv.getUint32(centralOffset + 20, true)
    const nameLen = dv.getUint16(centralOffset + 28, true)
    const extraLen = dv.getUint16(centralOffset + 30, true)
    const commentLen = dv.getUint16(centralOffset + 32, true)
    const localOffset = dv.getUint32(centralOffset + 42, true)
    const nameBytes = bytes.slice(centralOffset + 46, centralOffset + 46 + nameLen)
    const path = new TextDecoder().decode(nameBytes)

    // Read local header to find actual data offset (name/extra lengths can differ)
    const lNameLen = dv.getUint16(localOffset + 26, true)
    const lExtraLen = dv.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const raw = bytes.slice(dataStart, dataStart + compSize)

    let content
    if (method === 0) {
      content = raw
    } else if (method === 8 && typeof DecompressionStream !== 'undefined') {
      const ds = new DecompressionStream('deflate-raw')
      const stream = new Blob([raw]).stream().pipeThrough(ds)
      content = new Uint8Array(await new Response(stream).arrayBuffer())
    } else {
      content = null // unsupported method
    }

    if (!path.endsWith('/') && content) files.push({ path, content })
    centralOffset += 46 + nameLen + extraLen + commentLen
  }
  return files
}

export function downloadBlob(blob, filename) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename })
  a.click()
  URL.revokeObjectURL(a.href)
}
