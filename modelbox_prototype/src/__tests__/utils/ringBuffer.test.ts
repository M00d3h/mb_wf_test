import { describe, it, expect } from 'vitest'
import { RingBuffer } from '@main/utils/ringBuffer'
import type { LogLine } from '@shared/types'

function line(text: string, seq = 0): LogLine {
  return { text, seq, ts: 0 }
}

describe('RingBuffer', () => {
  describe('push / getAll', () => {
    it('starts empty', () => {
      expect(new RingBuffer().getAll()).toEqual([])
      expect(new RingBuffer().size).toBe(0)
    })

    it('appends lines', () => {
      const rb = new RingBuffer()
      rb.push(line('a'))
      rb.push(line('b'))
      expect(rb.getAll().map((l) => l.text)).toEqual(['a', 'b'])
    })

    it('returns a copy from getAll (not internal reference)', () => {
      const rb = new RingBuffer()
      rb.push(line('a'))
      const copy = rb.getAll()
      copy.push(line('b'))
      expect(rb.size).toBe(1)
    })

    it('respects custom maxLines', () => {
      const rb = new RingBuffer(3)
      for (let i = 0; i < 5; i++) rb.push(line(`L${i}`))
      expect(rb.size).toBe(3)
      expect(rb.getAll().map((l) => l.text)).toEqual(['L2', 'L3', 'L4'])
    })

    it('trims oldest lines when max is exceeded', () => {
      const rb = new RingBuffer(2)
      rb.push(line('old1'))
      rb.push(line('old2'))
      rb.push(line('new'))
      const texts = rb.getAll().map((l) => l.text)
      expect(texts).not.toContain('old1')
      expect(texts).toContain('new')
    })
  })

  describe('getLast', () => {
    it('returns undefined on empty buffer', () => {
      expect(new RingBuffer().getLast()).toBeUndefined()
    })

    it('returns the last line', () => {
      const rb = new RingBuffer()
      rb.push(line('first'))
      rb.push(line('last'))
      expect(rb.getLast()!.text).toBe('last')
    })
  })

  describe('replaceLast', () => {
    it('replaces the last line in-place', () => {
      const rb = new RingBuffer()
      rb.push(line('original'))
      rb.replaceLast(line('updated'))
      expect(rb.size).toBe(1)
      expect(rb.getLast()!.text).toBe('updated')
    })

    it('pushes when buffer is empty (acts like push)', () => {
      const rb = new RingBuffer()
      rb.replaceLast(line('first'))
      expect(rb.size).toBe(1)
      expect(rb.getLast()!.text).toBe('first')
    })

    it('does not grow size when replacing', () => {
      const rb = new RingBuffer()
      rb.push(line('a'))
      rb.push(line('b'))
      rb.replaceLast(line('B-replaced'))
      expect(rb.size).toBe(2)
      expect(rb.getAll()[1]!.text).toBe('B-replaced')
    })
  })

  describe('clear', () => {
    it('empties the buffer', () => {
      const rb = new RingBuffer()
      rb.push(line('a'))
      rb.push(line('b'))
      rb.clear()
      expect(rb.size).toBe(0)
      expect(rb.getAll()).toEqual([])
    })

    it('allows pushing after clear', () => {
      const rb = new RingBuffer()
      rb.push(line('a'))
      rb.clear()
      rb.push(line('b'))
      expect(rb.getAll().map((l) => l.text)).toEqual(['b'])
    })
  })
})
