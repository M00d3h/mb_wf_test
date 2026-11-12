import { openSync, readSync, closeSync, statSync } from 'fs'

/** Matches @huggingface/gguf GGUFValueType */
const enum GgufType {
  UINT8 = 0,
  INT8 = 1,
  UINT16 = 2,
  INT16 = 3,
  UINT32 = 4,
  INT32 = 5,
  FLOAT32 = 6,
  BOOL = 7,
  STRING = 8,
  ARRAY = 9,
  UINT64 = 10,
  INT64 = 11,
  FLOAT64 = 12
}

const MAX_READ = 32 * 1024 * 1024
const MIN_CONTEXT = 256
const MAX_CONTEXT = 256 * 1024 * 1024
const MIN_BLOCK = 1
const MAX_BLOCK = 4096

export interface GgufModelLimits {
  maxContextTokens?: number
  blockCount?: number
  /** From `general.file_type` KV (llama.cpp `llama_ftype`); short label for UI chips */
  quantLabel?: string
}

/** Maps GGUF `general.file_type` (llama.cpp `llama_ftype`) to a compact tag (aligned with filename-style quants). */
function mapLlamaFtype(raw: number): string | null {
  if (!Number.isFinite(raw) || raw < 0) return null
  // LLAMA_FTYPE_GUESSED — not a real on-disk type
  if (raw === 1024) return null
  const table: Record<number, string> = {
    0: 'F32',
    1: 'F16',
    2: 'Q4_0',
    3: 'Q4_1',
    7: 'Q8_0',
    8: 'Q5_0',
    9: 'Q5_1',
    10: 'Q2_K',
    11: 'Q3_K_S',
    12: 'Q3_K_M',
    13: 'Q3_K_L',
    14: 'Q4_K_S',
    15: 'Q4_K_M',
    16: 'Q5_K_S',
    17: 'Q5_K_M',
    18: 'Q6_K',
    19: 'IQ2_XXS',
    20: 'IQ2_XS',
    21: 'Q2_K_S',
    22: 'IQ3_XS',
    23: 'IQ3_XXS',
    24: 'IQ1_S',
    25: 'IQ4_NL',
    26: 'IQ3_S',
    27: 'IQ3_M',
    28: 'IQ2_S',
    29: 'IQ2_M',
    30: 'IQ4_XS',
    31: 'IQ1_M',
    32: 'BF16',
    36: 'TQ1_0',
    37: 'TQ2_0',
    38: 'MXFP4_MOE',
    39: 'NVFP4',
    40: 'Q1_0',
  }
  return table[raw] ?? null
}

function readVersionedUint(
  buf: Buffer,
  offset: number,
  version: number
): [bigint, number] {
  if (version === 1) {
    return [BigInt(buf.readUInt32LE(offset)), offset + 4]
  }
  return [buf.readBigUInt64LE(offset), offset + 8]
}

function readGgufString(
  buf: Buffer,
  offset: number,
  version: number
): [string, number] {
  const [len, off] = readVersionedUint(buf, offset, version)
  const n = Number(len)
  if (n < 0 || n > 1_000_000 || off + n > buf.length) {
    throw new Error('Invalid GGUF string length')
  }
  const s = buf.subarray(off, off + n).toString('utf8')
  return [s, off + n]
}

function skipMetadataValue(
  buf: Buffer,
  offset: number,
  type: number,
  version: number
): number {
  switch (type) {
    case GgufType.UINT8:
    case GgufType.INT8:
    case GgufType.BOOL:
      return offset + 1
    case GgufType.UINT16:
    case GgufType.INT16:
      return offset + 2
    case GgufType.UINT32:
    case GgufType.INT32:
    case GgufType.FLOAT32:
      return offset + 4
    case GgufType.UINT64:
    case GgufType.INT64:
      return offset + 8
    case GgufType.FLOAT64:
      return offset + 8
    case GgufType.STRING:
      return readGgufString(buf, offset, version)[1]
    case GgufType.ARRAY: {
      const elemType = buf.readUInt32LE(offset)
      const [nEl, off0] = readVersionedUint(buf, offset + 4, version)
      let o = off0
      const n = Number(nEl)
      if (n < 0 || n > 1_000_000) throw new Error('Invalid GGUF array length')
      for (let i = 0; i < n; i++) {
        o = skipMetadataValue(buf, o, elemType, version)
        if (o > buf.length) throw new Error('GGUF array read past buffer')
      }
      return o
    }
    default:
      throw new Error(`Unsupported GGUF metadata type: ${type}`)
  }
}

function toSafeNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'bigint') {
    const n = Number(v)
    return Number.isSafeInteger(n) ? n : null
  }
  return null
}

function isContextKey(key: string): boolean {
  if (!key.endsWith('.context_length')) return false
  if (key.startsWith('clip.')) return false
  if (key.includes('vision') && key.includes('context')) return false
  return true
}

function isBlockKey(key: string): boolean {
  if (!key.endsWith('.block_count')) return false
  if (key.startsWith('clip.')) return false
  return true
}

/**
 * Read training / architecture context length and transformer block count from a GGUF file header.
 */
export function readGgufModelLimits(ggufPath: string): GgufModelLimits {
  const st = statSync(ggufPath)
  // Use numeric Math.min only — Math.min(BigInt, BigInt) throws in Node/Electron.
  const toRead = Math.min(MAX_READ, Number(st.size))
  const fd = openSync(ggufPath, 'r')
  try {
    const buf = Buffer.allocUnsafe(toRead)
    readSync(fd, buf, 0, toRead, 0)
    if (buf.length < 24 || buf.toString('ascii', 0, 4) !== 'GGUF') {
      return {}
    }

    const version = buf.readUInt32LE(4)
    if (version !== 1 && version !== 2 && version !== 3) {
      return {}
    }

    let offset = 8
    const [_tensorCount, o1] = readVersionedUint(buf, offset, version)
    offset = o1
    const [kvCount, o2] = readVersionedUint(buf, offset, version)
    offset = o2

    const nKv = Number(kvCount)
    if (nKv < 0 || nKv > 50_000) return {}

    const contexts: number[] = []
    const blocks: number[] = []
    let quantLabel: string | undefined

    for (let i = 0; i < nKv; i++) {
      if (offset >= buf.length - 8) break
      const [key, kEnd] = readGgufString(buf, offset, version)
      offset = kEnd
      if (offset + 4 > buf.length) break
      const valueType = buf.readUInt32LE(offset)
      offset += 4

      if (isContextKey(key)) {
        if (
          valueType === GgufType.UINT32 ||
          valueType === GgufType.INT32 ||
          valueType === GgufType.UINT64 ||
          valueType === GgufType.INT64
        ) {
          let raw: unknown
          if (valueType === GgufType.UINT32) raw = buf.readUInt32LE(offset)
          else if (valueType === GgufType.INT32) raw = buf.readInt32LE(offset)
          else if (valueType === GgufType.UINT64)
            raw = buf.readBigUInt64LE(offset)
          else raw = buf.readBigInt64LE(offset)
          const n = toSafeNumber(raw)
          if (n != null && n >= MIN_CONTEXT && n <= MAX_CONTEXT) {
            contexts.push(n)
          }
        }
      } else if (isBlockKey(key)) {
        if (
          valueType === GgufType.UINT32 ||
          valueType === GgufType.INT32 ||
          valueType === GgufType.UINT64 ||
          valueType === GgufType.INT64
        ) {
          let raw: unknown
          if (valueType === GgufType.UINT32) raw = buf.readUInt32LE(offset)
          else if (valueType === GgufType.INT32) raw = buf.readInt32LE(offset)
          else if (valueType === GgufType.UINT64)
            raw = buf.readBigUInt64LE(offset)
          else raw = buf.readBigInt64LE(offset)
          const n = toSafeNumber(raw)
          if (n != null && n >= MIN_BLOCK && n <= MAX_BLOCK) {
            blocks.push(n)
          }
        }
      } else if (key === 'general.file_type') {
        if (
          valueType === GgufType.UINT32 ||
          valueType === GgufType.INT32 ||
          valueType === GgufType.UINT64 ||
          valueType === GgufType.INT64
        ) {
          let raw: number
          if (valueType === GgufType.UINT32) raw = buf.readUInt32LE(offset)
          else if (valueType === GgufType.INT32) raw = buf.readInt32LE(offset)
          else if (valueType === GgufType.UINT64)
            raw = Number(buf.readBigUInt64LE(offset))
          else raw = Number(buf.readBigInt64LE(offset))
          const mapped = mapLlamaFtype(raw)
          if (mapped) quantLabel = mapped
        }
      }

      offset = skipMetadataValue(buf, offset, valueType, version)
    }

    const out: GgufModelLimits = {}
    if (contexts.length > 0) {
      out.maxContextTokens = Math.max(...contexts)
    }
    if (blocks.length > 0) {
      out.blockCount = Math.max(...blocks)
    }
    if (quantLabel) {
      out.quantLabel = quantLabel
    }
    return out
  } catch {
    return {}
  } finally {
    closeSync(fd)
  }
}
