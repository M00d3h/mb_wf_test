import type { ParseCommandLineResult } from '@shared/types'

/**
 * Split a command line into argv-style tokens.
 * Supports both double-quoted (`"..."`) and single-quoted (`'...'`) segments.
 * First token is the executable; remainder are arguments.
 */
export function parseCommandLine(line: string): { executable: string; args: string[] } {
  const s = line.trim()
  if (!s) throw new Error('Command is empty')

  const tokens: string[] = []
  let i = 0
  const len = s.length

  while (i < len) {
    while (i < len && /\s/.test(s[i]!)) i++
    if (i >= len) break

    if (s[i] === '"') {
      i++
      let cur = ''
      while (i < len) {
        // POSIX double-quote: \\ → \ and \" → "  (handle both escapes)
        if (s[i] === '\\' && i + 1 < len && (s[i + 1] === '"' || s[i + 1] === '\\')) {
          cur += s[i + 1]!
          i += 2
          continue
        }
        if (s[i] === '"') {
          i++
          break
        }
        cur += s[i]!
        i++
      }
      tokens.push(cur)
    } else if (s[i] === "'") {
      i++
      let cur = ''
      while (i < len) {
        // POSIX single-quote: no escape sequences; only a closing ' ends the segment
        if (s[i] === "'") {
          i++
          break
        }
        cur += s[i]!
        i++
      }
      tokens.push(cur)
    } else {
      let cur = ''
      while (i < len && !/\s/.test(s[i]!) && s[i] !== '"' && s[i] !== "'") {
        cur += s[i]!
        i++
      }
      tokens.push(cur)
    }
  }

  if (tokens.length === 0) throw new Error('Command is empty')
  const executable = tokens[0]!
  const args = tokens.slice(1)
  return { executable, args }
}

export function tryParseCommandLine(line: string): ParseCommandLineResult {
  try {
    return { ok: true, ...parseCommandLine(line) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
