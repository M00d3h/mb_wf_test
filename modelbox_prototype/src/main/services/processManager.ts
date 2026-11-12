import { spawn, ChildProcess, execSync } from 'child_process'
import { BrowserWindow } from 'electron'
import { RingBuffer } from '../utils/ringBuffer'
import { HealthPoller } from './healthPoller'
import { updateInstanceState } from '../db/repos/serverInstances.repo'
import type { ServerState, LogLine, ServerInstanceKind } from '@shared/types'

interface ManagedProcess {
  child: ChildProcess
  buffer: RingBuffer
  poller: HealthPoller | null
  instanceId: string
  instanceKind: ServerInstanceKind
  host: string
  port: number
  connectionHost?: string
}

const processes = new Map<string, ManagedProcess>()
/** Last completed run per instance (survives process exit so getLogs / Server tab still work). */
const archivedLogs = new Map<string, LogLine[]>()
// Track instances we intentionally stopped so exit handler marks them 'stopped' not 'error'
const intentionalStops = new Set<string>()

const LOG_PREV_SESSION = '\n[ModelBox] ─── Previous session ───\n'

function archiveLines(instanceId: string, lines: LogLine[]): void {
  archivedLogs.set(instanceId, lines.slice(-5000))
}

export function clearArchivedLogs(instanceId: string): void {
  archivedLogs.delete(instanceId)
}

export function clearAllLogs(): void {
  archivedLogs.clear()
}

function pushAndEmit(buffer: RingBuffer, line: LogLine): void {
  buffer.push(line)
  sendToRenderer('server:log-chunk', line)
}

function sendToRenderer(channel: string, payload: unknown): void {
  const wins = BrowserWindow.getAllWindows()
  for (const win of wins) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function setState(instanceId: string, state: ServerState, pid?: number | null): void {
  updateInstanceState(
    instanceId,
    state,
    pid,
    state === 'starting' || state === 'loading' || state === 'running' || state.startsWith('vllm-') ? new Date().toISOString() : null,
    state === 'stopped' || state === 'error' ? new Date().toISOString() : null
  )
  sendToRenderer('server:state-change', { instanceId, state, pid })
}

export function startProcess(
  instanceId: string,
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  host: string,
  port: number,
  instanceKind: ServerInstanceKind = 'llama',
  connectionHost?: string
): void {
  if (processes.has(instanceId)) {
    throw new Error(`Instance ${instanceId} is already running`)
  }

  // Emit the full spawn command so it appears in the instance log for debugging.
  const debugLine: LogLine = {
    instanceId,
    stream: 'stderr',
    text: `[ModelBox] spawn: ${executable} ${args.map(a => a.includes(' ') ? JSON.stringify(a) : a).join(' ')}`,
    timestamp: Date.now()
  }

  const child = spawn(executable, args, {
    env,
    detached: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  const buffer = new RingBuffer()
  buffer.push(debugLine)
  sendToRenderer('server:log-chunk', debugLine)

  const managed: ManagedProcess = {
    child,
    buffer,
    poller: null,
    instanceId,
    instanceKind,
    host,
    port,
    connectionHost
  }
  processes.set(instanceId, managed)

  setState(instanceId, 'starting', child.pid)

  /** Coalesce tiny writes (e.g. progress dots) so each chunk is not a separate log row. */
  const pending: { stdout: string; stderr: string } = { stdout: '', stderr: '' }
  const flushTimers: { stdout: NodeJS.Timeout | null; stderr: NodeJS.Timeout | null } = {
    stdout: null,
    stderr: null
  }
  const FLUSH_MS = 48

  /**
   * One logical row per incomplete line: update the last row in place when the stream
   * still hasn't printed a newline (matches terminal behavior for progress dots).
   */
  const emitStreamLine = (stream: 'stdout' | 'stderr', text: string): void => {
    if (!text) return
    const last = buffer.getLast()
    if (last && last.stream === stream && !last.text.endsWith('\n')) {
      const updated: LogLine = {
        ...last,
        text,
        timestamp: Date.now(),
        replacesLast: true
      }
      buffer.replaceLast(updated)
      sendToRenderer('server:log-chunk', updated)
    } else {
      const line: LogLine = { instanceId, stream, text, timestamp: Date.now() }
      buffer.push(line)
      sendToRenderer('server:log-chunk', line)
    }
  }

  const flushStream = (stream: 'stdout' | 'stderr'): void => {
    const t = flushTimers[stream]
    if (t) {
      clearTimeout(t)
      flushTimers[stream] = null
    }
    const p = pending[stream]
    if (!p) return
    pending[stream] = ''
    emitStreamLine(stream, p)
  }

  const scheduleFlush = (stream: 'stdout' | 'stderr'): void => {
    if (flushTimers[stream]) clearTimeout(flushTimers[stream]!)
    flushTimers[stream] = setTimeout(() => {
      flushTimers[stream] = null
      flushStream(stream)
    }, FLUSH_MS)
  }

  const flushAllPendingStreams = (): void => {
    for (const s of ['stdout', 'stderr'] as const) {
      flushStream(s)
    }
  }

  const handleData = (stream: 'stdout' | 'stderr', data: Buffer): void => {
    if (flushTimers[stream]) {
      clearTimeout(flushTimers[stream]!)
      flushTimers[stream] = null
    }
    let chunk = pending[stream] + data.toString('utf8')
    pending[stream] = ''

    while (true) {
      const nl = chunk.indexOf('\n')
      if (nl === -1) break
      const line = chunk.slice(0, nl + 1)
      chunk = chunk.slice(nl + 1)
      emitStreamLine(stream, line)

      // vLLM Granular Status Parsing
      if (instanceKind === 'vllm' && !healthyFired) {
        if (line.includes('Loading weights') || line.includes('loading weights') || line.includes('Loading model shards')) {
          setState(instanceId, 'vllm-shards', child.pid)
        } else if (line.includes('Compiling') || line.includes('torch.compile')) {
          setState(instanceId, 'vllm-compile', child.pid)
        } else if (line.includes('Capturing cudagraphs')) {
          setState(instanceId, 'vllm-cudagraph', child.pid)
        } else if (line.includes('Application startup complete') || line.includes('application startup complete')) {
          // Uvicorn signals the HTTP server is ready — mark running immediately
          // as a fallback in case the HTTP health poll can't reach WSL2 loopback.
          healthyFired = true
          managed.poller?.stop()
          const m = processes.get(instanceId)
          if (m) setState(instanceId, 'running', child.pid)
        }
      }
    }

    if (chunk.includes('\r')) {
      const lastCr = chunk.lastIndexOf('\r')
      chunk = chunk.slice(lastCr + 1)
    }

    pending[stream] = chunk
    if (pending[stream]) {
      scheduleFlush(stream)
    }
  }

  const pollHost = connectionHost ?? host
  const displayHost = pollHost === '0.0.0.0' ? '127.0.0.1' : pollHost

  // Declared before handleData so the log trigger can read/write them via closure.
  let healthyFired = false

  child.stdout?.on('data', (d: Buffer) => handleData('stdout', d))
  child.stderr?.on('data', (d: Buffer) => handleData('stderr', d))

  const poller = new HealthPoller({
    host: pollHost,
    port,
    intervalMs: 3000,
    onHealthy: () => {
      if (healthyFired) return
      healthyFired = true
      poller.stop()
      const m = processes.get(instanceId)
      if (m) setState(instanceId, 'running', child.pid)
    },
    onLoading: () => {
      if (healthyFired) return
      const m = processes.get(instanceId)
      // Only set 'loading' if not already in a more specific vLLM state
      if (m && m.instanceKind === 'llama') {
        setState(instanceId, 'loading', child.pid)
      }
    },
    onUnhealthy: () => {
      // still starting — connection refused / timeout — no state change
    }
  })
  managed.poller = poller
  poller.start()

  child.on('exit', (code, signal) => {
    poller.stop()
    flushAllPendingStreams()
    const wasIntentional = intentionalStops.delete(instanceId)
    const finalState: ServerState = wasIntentional || code === 0 ? 'stopped' : 'error'

    let summary: string
    if (wasIntentional) {
      summary = `[ModelBox] Process stopped.\n`
    } else if (signal) {
      summary = `[ModelBox] Process exited on signal ${signal}.\n`
    } else if (code === 0) {
      summary = `[ModelBox] Process exited with code 0.\n`
    } else {
      const reason =
        code != null ? `exit code ${code}` : 'unknown exit reason'
      const healthHint = !healthyFired
        ? ` The server never reported healthy at http://${displayHost}:${port}/health — see output above for load errors.`
        : ''
      summary = `[ModelBox] Process exited (${reason}).${healthHint}\n`
    }

    const summaryLine: LogLine = {
      instanceId,
      stream: 'stderr',
      text: summary,
      timestamp: Date.now()
    }
    buffer.push(summaryLine)
    sendToRenderer('server:log-chunk', summaryLine)

    archiveLines(instanceId, buffer.getAll())
    processes.delete(instanceId)

    setState(instanceId, finalState, null)
  })

  child.on('error', (err) => {
    poller.stop()
    flushAllPendingStreams()
    const errLine: LogLine = {
      instanceId,
      stream: 'stderr',
      text: `[ModelBox] Failed to spawn process: ${err.message}\n`,
      timestamp: Date.now()
    }
    pushAndEmit(buffer, errLine)
    archiveLines(instanceId, buffer.getAll())
    processes.delete(instanceId)
    setState(instanceId, 'error', null)
  })
}

export async function stopProcess(instanceId: string): Promise<void> {
  const managed = processes.get(instanceId)
  if (!managed) return

  intentionalStops.add(instanceId)
  managed.poller?.stop()
  const { child } = managed

  child.kill()

  // On Windows, also use taskkill after a grace period
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (child.pid) {
        try {
          execSync(`taskkill /F /PID ${child.pid}`, { stdio: 'ignore' })
        } catch {
          // already dead
        }
      }
      resolve()
    }, 3000)

    child.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

export function getLogs(instanceId: string): LogLine[] {
  const managed = processes.get(instanceId)
  const live = managed?.buffer.getAll() ?? []
  const archived = archivedLogs.get(instanceId) ?? []
  if (live.length === 0) return archived
  if (archived.length === 0) return live
  const sep: LogLine = {
    instanceId,
    stream: 'stderr',
    text: LOG_PREV_SESSION,
    timestamp: Date.now()
  }
  return [...archived, sep, ...live]
}

export function getConnectionHost(instanceId: string): string | undefined {
  return processes.get(instanceId)?.connectionHost
}

export function isRunning(instanceId: string): boolean {
  return processes.has(instanceId)
}

export function getRunningPids(): Map<string, number | undefined> {
  const result = new Map<string, number | undefined>()
  for (const [id, m] of processes.entries()) {
    result.set(id, m.child.pid)
  }
  return result
}

export async function stopAllProcesses(): Promise<void> {
  const ids = [...processes.keys()]
  await Promise.all(ids.map((id) => stopProcess(id)))
}
