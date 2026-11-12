import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export function formatUptime(startedAt: string | null): string {
  if (!startedAt) return '—'
  const ms = Date.now() - new Date(startedAt).getTime()
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

export function extractQuant(filename: string): string | null {
  // Quant / dtype tokens: Q*, IQ*, MXFP*, and fp16/bf16/f16/f32 (often as .bf16. or -fp16- in filenames)
  const match = filename.match(
    /[\._-](Q\d[A-Z0-9_]+|IQ\d[A-Z0-9_]+|MXFP\d|BF16|FP16|F16|F32)/i,
  )
  return match ? match[1].toUpperCase() : null
}
