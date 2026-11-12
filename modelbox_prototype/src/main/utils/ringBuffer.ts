import type { LogLine } from '@shared/types'

const MAX_LINES = 5000

export class RingBuffer {
  private buf: LogLine[] = []
  private maxLines: number

  constructor(maxLines = MAX_LINES) {
    this.maxLines = maxLines
  }

  push(line: LogLine): void {
    this.buf.push(line)
    if (this.buf.length > this.maxLines) {
      this.buf.splice(0, this.buf.length - this.maxLines)
    }
  }

  getAll(): LogLine[] {
    return this.buf.slice()
  }

  getLast(): LogLine | undefined {
    return this.buf.length === 0 ? undefined : this.buf[this.buf.length - 1]
  }

  replaceLast(line: LogLine): void {
    if (this.buf.length === 0) {
      this.push(line)
    } else {
      this.buf[this.buf.length - 1] = line
    }
  }

  clear(): void {
    this.buf = []
  }

  get size(): number {
    return this.buf.length
  }
}
