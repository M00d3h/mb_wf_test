import { describe, it, expect } from 'vitest'
import { parseCommandLine, tryParseCommandLine } from '@main/services/commandLineParse'

describe('parseCommandLine', () => {
  describe('error cases', () => {
    it('throws on empty string', () => {
      expect(() => parseCommandLine('')).toThrow('Command is empty')
    })

    it('throws on whitespace-only string', () => {
      expect(() => parseCommandLine('   ')).toThrow('Command is empty')
    })
  })

  describe('single token', () => {
    it('parses a bare executable with no args', () => {
      const { executable, args } = parseCommandLine('llama-server')
      expect(executable).toBe('llama-server')
      expect(args).toEqual([])
    })

    it('trims leading and trailing whitespace', () => {
      const { executable } = parseCommandLine('  llama-server  ')
      expect(executable).toBe('llama-server')
    })
  })

  describe('multiple tokens', () => {
    it('splits on spaces', () => {
      const { executable, args } = parseCommandLine('llama-server -m model.gguf')
      expect(executable).toBe('llama-server')
      expect(args).toEqual(['-m', 'model.gguf'])
    })

    it('collapses multiple consecutive spaces', () => {
      const { args } = parseCommandLine('exe  -a   -b')
      expect(args).toEqual(['-a', '-b'])
    })

    it('handles flag=value tokens without splitting on =', () => {
      const { args } = parseCommandLine('exe --port=8080')
      expect(args).toEqual(['--port=8080'])
    })
  })

  describe('double-quoted strings', () => {
    it('preserves spaces inside double quotes', () => {
      const { args } = parseCommandLine('exe -m "path with spaces/model.gguf"')
      expect(args).toEqual(['-m', 'path with spaces/model.gguf'])
    })

    it('handles escaped double-quote inside double-quoted string', () => {
      const { args } = parseCommandLine('exe --flag "foo\\"bar"')
      expect(args).toEqual(['--flag', 'foo"bar'])
    })

    it('handles escaped backslash inside double-quoted string', () => {
      const { args } = parseCommandLine('exe --flag "foo\\\\bar"')
      expect(args).toEqual(['--flag', 'foo\\bar'])
    })

    it('parses Windows path as executable', () => {
      const { executable } = parseCommandLine('"C:\\Program Files\\llama\\llama-server.exe" -m model.gguf')
      expect(executable).toBe('C:\\Program Files\\llama\\llama-server.exe')
    })

    it('handles empty double-quoted string as an arg', () => {
      const { args } = parseCommandLine('exe ""')
      expect(args).toEqual([''])
    })
  })

  describe('single-quoted strings', () => {
    it('preserves spaces inside single quotes', () => {
      const { args } = parseCommandLine("exe -m 'path with spaces/model.gguf'")
      expect(args).toEqual(['-m', 'path with spaces/model.gguf'])
    })

    it('does not process escape sequences inside single quotes', () => {
      // POSIX: single quotes are literal — backslash is not special
      const { args } = parseCommandLine("exe --flag 'foo\\nbar'")
      expect(args).toEqual(['--flag', 'foo\\nbar'])
    })
  })

  describe('mixed quoting', () => {
    it('handles quoted and unquoted tokens in sequence', () => {
      const { executable, args } = parseCommandLine('/usr/bin/exe -m "my model" --port 8080')
      expect(executable).toBe('/usr/bin/exe')
      expect(args).toEqual(['-m', 'my model', '--port', '8080'])
    })

    it('handles multiple quoted args', () => {
      const { args } = parseCommandLine("exe 'first arg' \"second arg\"")
      expect(args).toEqual(['first arg', 'second arg'])
    })
  })

  describe('result structure', () => {
    it('first token is always the executable', () => {
      const { executable, args } = parseCommandLine('/path/to/server -a -b -c')
      expect(executable).toBe('/path/to/server')
      expect(args).toHaveLength(3)
    })
  })
})

describe('tryParseCommandLine', () => {
  it('returns ok:true with executable and args on success', () => {
    const result = tryParseCommandLine('server -m model.gguf')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.executable).toBe('server')
      expect(result.args).toEqual(['-m', 'model.gguf'])
    }
  })

  it('returns ok:false with error message on empty input', () => {
    const result = tryParseCommandLine('')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/empty/i)
    }
  })

  it('never throws', () => {
    expect(() => tryParseCommandLine('')).not.toThrow()
    expect(() => tryParseCommandLine('   ')).not.toThrow()
  })
})
