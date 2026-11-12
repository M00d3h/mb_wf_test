import { describe, it, expect } from 'vitest'
import {
  isActiveState,
  conversationMatchesInstance,
} from '@renderer/lib/serverInstanceMatch'
import type { ServerState } from '@shared/types'

const inst = (host: string, port: number) => ({ host, port })

// ─── isActiveState ───────────────────────────────────────────────────────────

describe('isActiveState', () => {
  const activeStates: ServerState[] = [
    'running',
    'loading',
    'starting',
    'vllm-shards',
    'vllm-compile',
    'vllm-cudagraph',
  ]
  const inactiveStates: ServerState[] = ['stopped', 'error']

  for (const s of activeStates) {
    it(`returns true for "${s}"`, () => {
      expect(isActiveState(s)).toBe(true)
    })
  }

  for (const s of inactiveStates) {
    it(`returns false for "${s}"`, () => {
      expect(isActiveState(s)).toBe(false)
    })
  }
})

// ─── conversationMatchesInstance ─────────────────────────────────────────────

describe('conversationMatchesInstance', () => {
  it('returns false when convHost is null', () => {
    expect(conversationMatchesInstance(null, 8080, inst('127.0.0.1', 8080))).toBe(false)
  })

  it('returns false when convPort is null', () => {
    expect(conversationMatchesInstance('127.0.0.1', null, inst('127.0.0.1', 8080))).toBe(false)
  })

  it('returns false when both are null', () => {
    expect(conversationMatchesInstance(null, null, inst('127.0.0.1', 8080))).toBe(false)
  })

  it('returns false when convHost is undefined', () => {
    expect(conversationMatchesInstance(undefined, 8080, inst('127.0.0.1', 8080))).toBe(false)
  })

  it('matches identical host and port', () => {
    expect(conversationMatchesInstance('127.0.0.1', 8080, inst('127.0.0.1', 8080))).toBe(true)
  })

  it('matches loopback equivalents (127.0.0.1 ↔ localhost)', () => {
    expect(conversationMatchesInstance('localhost', 8080, inst('127.0.0.1', 8080))).toBe(true)
    expect(conversationMatchesInstance('127.0.0.1', 8080, inst('localhost', 8080))).toBe(true)
  })

  it('matches 0.0.0.0 (listen-all) against 127.0.0.1', () => {
    expect(conversationMatchesInstance('127.0.0.1', 8080, inst('0.0.0.0', 8080))).toBe(true)
  })

  it('returns false when ports differ', () => {
    expect(conversationMatchesInstance('127.0.0.1', 8080, inst('127.0.0.1', 9090))).toBe(false)
  })

  it('returns false for different non-loopback hosts', () => {
    expect(conversationMatchesInstance('192.168.1.1', 8080, inst('192.168.1.2', 8080))).toBe(false)
  })
})
