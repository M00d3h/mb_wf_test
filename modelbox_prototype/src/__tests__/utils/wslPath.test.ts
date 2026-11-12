import { describe, it, expect } from 'vitest'
import {
  windowsPathToWslMnt,
  parseWslUncPath,
  linuxPathToWslUnc,
} from '@main/utils/wslPath'

// ─── windowsPathToWslMnt ─────────────────────────────────────────────────────

describe('windowsPathToWslMnt', () => {
  it('returns empty string unchanged', () => {
    expect(windowsPathToWslMnt('')).toBe('')
  })

  it('returns Unix-style paths unchanged (already /mnt/... style)', () => {
    expect(windowsPathToWslMnt('/mnt/c/models')).toBe('/mnt/c/models')
    expect(windowsPathToWslMnt('/home/user/models')).toBe('/home/user/models')
  })

  it('converts C:\\ to /mnt/c/', () => {
    expect(windowsPathToWslMnt('C:\\')).toBe('/mnt/c/')
  })

  it('converts C:\\Users\\foo to /mnt/c/Users/foo', () => {
    expect(windowsPathToWslMnt('C:\\Users\\foo')).toBe('/mnt/c/Users/foo')
  })

  it('lowercases the drive letter', () => {
    expect(windowsPathToWslMnt('D:\\models')).toBe('/mnt/d/models')
    expect(windowsPathToWslMnt('E:\\data\\model.gguf')).toBe('/mnt/e/data/model.gguf')
  })

  it('handles forward-slash Windows paths', () => {
    expect(windowsPathToWslMnt('C:/models/test')).toBe('/mnt/c/models/test')
  })

  it('converts \\\\wsl$\\Ubuntu\\home\\user to /home/user', () => {
    const result = windowsPathToWslMnt('\\\\wsl$\\Ubuntu\\home\\user\\models')
    expect(result).toBe('/home/user/models')
  })

  it('converts \\\\wsl.localhost\\Ubuntu\\... to the linux path', () => {
    const result = windowsPathToWslMnt('\\\\wsl.localhost\\Ubuntu\\home\\user')
    expect(result).toBe('/home/user')
  })

  it('trims surrounding whitespace', () => {
    expect(windowsPathToWslMnt('  C:\\models  ')).toBe('/mnt/c/models')
  })

  it('converts path with nested directories', () => {
    const result = windowsPathToWslMnt('C:\\Users\\mohda\\.cache\\huggingface\\hub')
    expect(result).toBe('/mnt/c/Users/mohda/.cache/huggingface/hub')
  })
})

// ─── parseWslUncPath ─────────────────────────────────────────────────────────

describe('parseWslUncPath', () => {
  it('returns null for a regular Windows path', () => {
    expect(parseWslUncPath('C:\\models\\test')).toBeNull()
  })

  it('returns null for a Unix path', () => {
    expect(parseWslUncPath('/home/user/models')).toBeNull()
  })

  it('parses \\\\wsl$\\Ubuntu\\... correctly', () => {
    const result = parseWslUncPath('\\\\wsl$\\Ubuntu\\home\\user\\models')
    expect(result).not.toBeNull()
    expect(result!.distro).toBe('Ubuntu')
    expect(result!.linuxPath).toBe('/home/user/models')
  })

  it('parses \\\\wsl.localhost\\Ubuntu-22.04\\... correctly', () => {
    const result = parseWslUncPath('\\\\wsl.localhost\\Ubuntu-22.04\\home\\user')
    expect(result).not.toBeNull()
    expect(result!.distro).toBe('Ubuntu-22.04')
    expect(result!.linuxPath).toBe('/home/user')
  })

  it('is case-insensitive on the wsl$ prefix', () => {
    const result = parseWslUncPath('\\\\WSL$\\Ubuntu\\home\\user')
    expect(result).not.toBeNull()
    expect(result!.distro).toBe('Ubuntu')
  })

  it('ensures linuxPath starts with /', () => {
    const result = parseWslUncPath('\\\\wsl$\\Ubuntu\\home\\user')
    expect(result!.linuxPath).toMatch(/^\//)
  })

  it('handles forward-slash UNC paths too', () => {
    const result = parseWslUncPath('//wsl$/Ubuntu/home/user/models')
    expect(result).not.toBeNull()
    expect(result!.linuxPath).toBe('/home/user/models')
  })
})

// ─── linuxPathToWslUnc ───────────────────────────────────────────────────────

describe('linuxPathToWslUnc', () => {
  it('converts /home/user to \\\\wsl$\\Distro\\home\\user', () => {
    const result = linuxPathToWslUnc('Ubuntu', '/home/user')
    expect(result).toBe('\\\\wsl$\\Ubuntu\\home\\user')
  })

  it('uses the provided distro name verbatim', () => {
    const result = linuxPathToWslUnc('Ubuntu-22.04', '/home/user')
    expect(result).toContain('Ubuntu-22.04')
  })

  it('handles paths with multiple nested segments', () => {
    const result = linuxPathToWslUnc('Ubuntu', '/home/user/.cache/huggingface/hub')
    expect(result).toBe('\\\\wsl$\\Ubuntu\\home\\user\\.cache\\huggingface\\hub')
  })

  it('handles trailing slash gracefully', () => {
    const result = linuxPathToWslUnc('Ubuntu', '/home/user/')
    expect(result).toBe('\\\\wsl$\\Ubuntu\\home\\user')
  })

  it('handles root path /', () => {
    const result = linuxPathToWslUnc('Ubuntu', '/')
    // Root path → just the distro with no trailing backslash-segments
    expect(result).toBe('\\\\wsl$\\Ubuntu\\')
  })
})
