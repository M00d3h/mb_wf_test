import { describe, it, expect } from 'vitest'
import { hostPortMatchInstance } from '@shared/hostPortMatch'

const inst = (host: string, port: number) => ({ host, port })

describe('hostPortMatchInstance', () => {
  describe('exact matches', () => {
    it('matches identical host and port', () => {
      expect(hostPortMatchInstance('127.0.0.1', 8080, inst('127.0.0.1', 8080))).toBe(true)
    })

    it('matches identical hostname and port', () => {
      expect(hostPortMatchInstance('localhost', 8080, inst('localhost', 8080))).toBe(true)
    })
  })

  describe('loopback equivalence', () => {
    it('treats 127.0.0.1 and localhost as equivalent', () => {
      expect(hostPortMatchInstance('127.0.0.1', 8080, inst('localhost', 8080))).toBe(true)
      expect(hostPortMatchInstance('localhost', 8080, inst('127.0.0.1', 8080))).toBe(true)
    })

    it('treats ::1 and localhost as equivalent', () => {
      expect(hostPortMatchInstance('::1', 8080, inst('localhost', 8080))).toBe(true)
      expect(hostPortMatchInstance('localhost', 8080, inst('::1', 8080))).toBe(true)
    })

    it('treats ::1 and 127.0.0.1 as equivalent', () => {
      expect(hostPortMatchInstance('::1', 8080, inst('127.0.0.1', 8080))).toBe(true)
    })
  })

  describe('0.0.0.0 (listen-all) equivalence', () => {
    it('matches 0.0.0.0 instance against 127.0.0.1 caller', () => {
      expect(hostPortMatchInstance('127.0.0.1', 8080, inst('0.0.0.0', 8080))).toBe(true)
    })

    it('matches 0.0.0.0 instance against localhost caller', () => {
      expect(hostPortMatchInstance('localhost', 8080, inst('0.0.0.0', 8080))).toBe(true)
    })

    it('matches caller 0.0.0.0 against 127.0.0.1 instance', () => {
      expect(hostPortMatchInstance('0.0.0.0', 8080, inst('127.0.0.1', 8080))).toBe(true)
    })
  })

  describe('port mismatch', () => {
    it('returns false when ports differ, even with equivalent hosts', () => {
      expect(hostPortMatchInstance('127.0.0.1', 8080, inst('localhost', 9090))).toBe(false)
    })

    it('returns false when ports differ on exact same host', () => {
      expect(hostPortMatchInstance('127.0.0.1', 8080, inst('127.0.0.1', 8081))).toBe(false)
    })
  })

  describe('non-loopback addresses', () => {
    it('returns false for unrelated LAN addresses', () => {
      expect(hostPortMatchInstance('192.168.1.100', 8080, inst('localhost', 8080))).toBe(false)
    })

    it('matches two identical non-loopback addresses', () => {
      expect(hostPortMatchInstance('192.168.1.100', 8080, inst('192.168.1.100', 8080))).toBe(true)
    })

    it('returns false for different non-loopback addresses', () => {
      expect(hostPortMatchInstance('192.168.1.100', 8080, inst('192.168.1.101', 8080))).toBe(false)
    })
  })

  describe('case and whitespace normalisation', () => {
    it('is case-insensitive on host', () => {
      expect(hostPortMatchInstance('LOCALHOST', 8080, inst('localhost', 8080))).toBe(true)
    })

    it('trims surrounding whitespace from hosts', () => {
      expect(hostPortMatchInstance(' 127.0.0.1 ', 8080, inst('localhost', 8080))).toBe(true)
    })
  })

  describe('numeric string port coercion', () => {
    it('coerces string-like port values to numbers', () => {
      // TypeScript types say number but runtime coercion via Number() is explicit in the source
      expect(hostPortMatchInstance('127.0.0.1', 8080, { host: 'localhost', port: '8080' as unknown as number })).toBe(true)
    })
  })
})
