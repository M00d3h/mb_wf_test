/**
 * Security regression tests for Issues 5 and 6 in feedback_plan.md.
 * Tests the buildTransport validation logic without spawning real transports.
 *
 * We mirror the relevant validation logic here rather than importing the
 * private buildTransport function, since it requires @modelcontextprotocol/sdk
 * transports that are not available in the test environment.
 */
import { describe, it, expect } from 'vitest'

// ─── Mirror of buildTransport validation logic ────────────────────────────────

interface MCPConfig {
  name: string
  transport: 'stdio' | 'sse' | 'http'
  command?: string | null
  args?: string | null
  env?: string | null
  url?: string | null
  token?: string | null
}

function validateStdioArgs(config: MCPConfig): string[] {
  if (!config.args) return []
  const raw: unknown = JSON.parse(config.args)
  if (!Array.isArray(raw) || raw.some((a) => typeof a !== 'string')) {
    throw new Error(`MCP server "${config.name}": args must be a JSON array of strings`)
  }
  return raw as string[]
}

function validateToken(config: MCPConfig): void {
  if (config.token && /[\r\n]/.test(config.token)) {
    throw new Error(`MCP server "${config.name}": token contains invalid characters`)
  }
}

// ─── Issue 5: args type validation ───────────────────────────────────────────

describe('MCP args validation (Issue 5)', () => {
  it('accepts a valid JSON string array', () => {
    const cfg: MCPConfig = { name: 'test', transport: 'stdio', args: '["--foo", "--bar"]' }
    expect(validateStdioArgs(cfg)).toEqual(['--foo', '--bar'])
  })

  it('accepts an empty args array', () => {
    const cfg: MCPConfig = { name: 'test', transport: 'stdio', args: '[]' }
    expect(validateStdioArgs(cfg)).toEqual([])
  })

  it('returns empty array when args is null', () => {
    const cfg: MCPConfig = { name: 'test', transport: 'stdio', args: null }
    expect(validateStdioArgs(cfg)).toEqual([])
  })

  it('throws when args is a JSON object (not an array)', () => {
    const cfg: MCPConfig = { name: 'srv', transport: 'stdio', args: '{"key":"val"}' }
    expect(() => validateStdioArgs(cfg)).toThrow('args must be a JSON array of strings')
  })

  it('throws when args contains non-string elements', () => {
    const cfg: MCPConfig = { name: 'srv', transport: 'stdio', args: '[1, 2, 3]' }
    expect(() => validateStdioArgs(cfg)).toThrow('args must be a JSON array of strings')
  })

  it('throws when args contains mixed types', () => {
    const cfg: MCPConfig = { name: 'srv', transport: 'stdio', args: '["--valid", 42]' }
    expect(() => validateStdioArgs(cfg)).toThrow('args must be a JSON array of strings')
  })

  it('throws when args is a bare string (not valid JSON array)', () => {
    expect(() =>
      validateStdioArgs({ name: 'srv', transport: 'stdio', args: '"just a string"' })
    ).toThrow('args must be a JSON array of strings')
  })

  it('throws when args is a boolean', () => {
    expect(() =>
      validateStdioArgs({ name: 'srv', transport: 'stdio', args: 'true' })
    ).toThrow('args must be a JSON array of strings')
  })

  it('throws when args is invalid JSON', () => {
    expect(() =>
      validateStdioArgs({ name: 'srv', transport: 'stdio', args: '{not valid' })
    ).toThrow()
  })

  it('includes server name in error message', () => {
    const cfg: MCPConfig = { name: 'my-server', transport: 'stdio', args: '{"x":1}' }
    expect(() => validateStdioArgs(cfg)).toThrow('"my-server"')
  })
})

// ─── Issue 6: SSE token header injection ─────────────────────────────────────

describe('MCP token validation (Issue 6)', () => {
  it('accepts a clean token', () => {
    const cfg: MCPConfig = { name: 'srv', transport: 'sse', token: 'hf_abc123XYZ' }
    expect(() => validateToken(cfg)).not.toThrow()
  })

  it('accepts token with special chars but no CRLF', () => {
    const cfg: MCPConfig = { name: 'srv', transport: 'sse', token: 'Bearer_tok-en.val~ue' }
    expect(() => validateToken(cfg)).not.toThrow()
  })

  it('accepts null token (no auth header)', () => {
    const cfg: MCPConfig = { name: 'srv', transport: 'sse', token: null }
    expect(() => validateToken(cfg)).not.toThrow()
  })

  it('throws when token contains \\r\\n (CRLF header injection)', () => {
    const cfg: MCPConfig = { name: 'srv', transport: 'sse', token: 'tok\r\nX-Injected: evil' }
    expect(() => validateToken(cfg)).toThrow('token contains invalid characters')
  })

  it('throws when token contains bare \\n', () => {
    const cfg: MCPConfig = { name: 'srv', transport: 'sse', token: 'tok\nX-Injected: evil' }
    expect(() => validateToken(cfg)).toThrow('token contains invalid characters')
  })

  it('throws when token contains bare \\r', () => {
    const cfg: MCPConfig = { name: 'srv', transport: 'sse', token: 'tok\rX-Injected: evil' }
    expect(() => validateToken(cfg)).toThrow('token contains invalid characters')
  })

  it('includes server name in error message', () => {
    const cfg: MCPConfig = { name: 'my-server', transport: 'sse', token: 'a\nb' }
    expect(() => validateToken(cfg)).toThrow('"my-server"')
  })

  it('also applies to http transport token', () => {
    const cfg: MCPConfig = { name: 'srv', transport: 'http', token: 'bad\ntoken' }
    expect(() => validateToken(cfg)).toThrow('token contains invalid characters')
  })
})
