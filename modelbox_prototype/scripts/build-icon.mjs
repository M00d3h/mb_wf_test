import sharp from 'sharp'
import { writeFileSync } from 'fs'

const src = 'resources/icon.png'
const dest = 'resources/icon.ico'

const sizes = [256, 128, 64, 48, 32, 24, 16]
const images = []
let dataOffset = 6 + 16 * sizes.length // ICO header + entry table

for (const size of sizes) {
  const { data, info } = await sharp(src)
    .resize(size, size)
    .raw()
    .toBuffer({ resolveWithObject: true })

  const w = info.width
  const h = info.height
  const rowSize = Math.ceil((w * 4) / 4) * 4 // 4-byte aligned row
  const xorSize = rowSize * h
  const andSize = Math.ceil(w / 8) * h // 1 bit per pixel, row aligned to bytes
  const bmpHeight = h * 2 // ICO: BMP height = XOR + AND planes

  // BMP info header (BITMAPINFOHEADER)
  const bmpHeader = Buffer.alloc(40)
  bmpHeader.writeInt32LE(40, 0)
  bmpHeader.writeInt32LE(w, 4)
  bmpHeader.writeInt32LE(bmpHeight, 8)
  bmpHeader.writeUInt16LE(1, 12)
  bmpHeader.writeUInt16LE(32, 14)
  bmpHeader.writeUInt32LE(0, 16)  // BI_RGB
  bmpHeader.writeUInt32LE(xorSize + andSize, 20)
  bmpHeader.writeInt32LE(2835, 24)
  bmpHeader.writeInt32LE(2835, 28)
  bmpHeader.writeUInt32LE(0, 32)
  bmpHeader.writeUInt32LE(0, 36)

  // XOR plane: BGRA, bottom-to-top
  const xor = Buffer.alloc(xorSize)
  for (let y = 0; y < h; y++) {
    const srcY = h - 1 - y
    for (let x = 0; x < w; x++) {
      const si = (srcY * w + x) * 3
      const di = (y * rowSize + x * 4)
      xor[di] = data[si + 2]      // B
      xor[di + 1] = data[si + 1]  // G
      xor[di + 2] = data[si]      // R
      xor[di + 3] = 255           // A
    }
  }

  // AND plane: all 1s (no additional mask, alpha is in XOR plane)
  const and = Buffer.alloc(andSize)
  and.fill(0xFF)

  images.push({ bmpHeader, xor, and, imageSize: 40 + xorSize + andSize, offset: dataOffset, w, h })
  dataOffset += 40 + xorSize + andSize
}

// ICO header
const icoHeader = Buffer.alloc(6)
icoHeader.writeUInt16LE(0, 0)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(sizes.length, 4)

// ICO entry table
const entryTable = Buffer.alloc(16 * sizes.length)
images.forEach((img, i) => {
  const off = i * 16
  entryTable.writeUInt8(img.w === 256 ? 0 : img.w, off)
  entryTable.writeUInt8(img.h === 256 ? 0 : img.h, off + 1)
  entryTable.writeUInt8(0, off + 2)
  entryTable.writeUInt8(0, off + 3)
  entryTable.writeUInt16LE(1, off + 4)
  entryTable.writeUInt16LE(32, off + 6)
  entryTable.writeUInt32LE(img.imageSize, off + 8)
  entryTable.writeUInt32LE(img.offset, off + 12)
})

const ico = Buffer.concat([
  icoHeader,
  entryTable,
  ...images.flatMap(img => [img.bmpHeader, img.xor, img.and])
])

writeFileSync(dest, ico)
console.log(`Written ${dest} (${ico.length} bytes, ${sizes.length} sizes)`)
