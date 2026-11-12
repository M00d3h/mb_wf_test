import { create } from 'zustand'
import { api } from '../lib/ipc'
import { clearTransportCache } from '../lib/transport'
import type { ServerInstance, LogLine, QueueEntry, ServerState } from '@shared/types'

// ─── Log debounce buffer ──────────────────────────────────────────────────────
// Batches rapid log-chunk events so Zustand setState fires at most once per
// FLUSH_MS across a burst of lines (e.g. vLLM startup floods the log).

const FLUSH_MS = 80
const logBuffers = new Map<string, LogLine[]>()
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>()

function bufferLogLine(instanceId: string, line: LogLine): void {
  let buf = logBuffers.get(instanceId)
  if (!buf) {
    buf = []
    logBuffers.set(instanceId, buf)
  }
  const { replacesLast, ...rest } = line
  if (replacesLast && buf.length > 0) {
    const last = buf[buf.length - 1]!
    if (last.stream === (rest as LogLine).stream) {
      buf[buf.length - 1] = rest as LogLine
      return
    }
  }
  buf.push(rest as LogLine)
}

function flushLogBuffer(instanceId: string, replaceFirst = false): void {
  const buffered = logBuffers.get(instanceId)
  if (!buffered || buffered.length === 0) return
  logBuffers.delete(instanceId)
  useServerStore.setState((s) => {
    const existing = s.logs[instanceId] ?? []
    let merged: LogLine[]
    if (replaceFirst && existing.length > 0 && buffered.length > 0) {
      const first = buffered[0]!
      const rest = buffered.slice(1)
      merged = [...existing.slice(0, -1), first, ...rest]
    } else {
      merged = [...existing, ...buffered]
    }
    return { logs: { ...s.logs, [instanceId]: merged.slice(-5000) } }
  })
}

function scheduleFlush(instanceId: string, replaceFirst: boolean): void {
  const existing = flushTimers.get(instanceId)
  if (existing) clearTimeout(existing)
  flushTimers.set(
    instanceId,
    setTimeout(() => {
      flushTimers.delete(instanceId)
      flushLogBuffer(instanceId, replaceFirst)
    }, FLUSH_MS)
  )
}

function flushImmediately(instanceId: string): void {
  const timer = flushTimers.get(instanceId)
  if (timer !== undefined) {
    clearTimeout(timer)
    flushTimers.delete(instanceId)
  }
  flushLogBuffer(instanceId)
}

interface ServerStore {
  instances: ServerInstance[]
  logs: Record<string, LogLine[]> // instanceId → lines
  selectedInstanceId: string | null
  /** The instance UUID the user last explicitly selected via the chat model picker.
   *  Auto-bind uses this to default new conversations to the user's preferred model. */
  preferredInstanceId: string | null
  queue: QueueEntry[]
  loading: boolean
  /** The most recently launched instance ID (for auto-select after relaunch). */
  lastLaunchedInstanceId: string | null

  fetchInstances: () => Promise<void>
  startServer: (
    profileId: string
  ) => Promise<{ instance: ServerInstance; queued: boolean }>
  stopServer: (instanceId: string) => Promise<void>
  restartServer: (instanceId: string) => Promise<void>
  fetchLogs: (instanceId: string) => Promise<void>
  selectInstance: (id: string | null) => void
  setPreferredInstance: (id: string) => void
  fetchQueue: () => Promise<void>
  cancelQueued: (id: string) => Promise<void>
  clearInstance: (instanceId: string) => Promise<void>
  /** Track a newly launched instance for auto-select in ServerPage. */
  trackLaunchedInstance: (instanceId: string) => void

  // Called from IPC event listeners
  onLogChunk: (line: LogLine) => void
  onStateChange: (payload: { instanceId: string; state: ServerState; pid?: number }) => void
  onQueueUpdate: (payload: { queue: QueueEntry[] }) => void
}

export const useServerStore = create<ServerStore>((set, get) => ({
  instances: [],
  logs: {},
  selectedInstanceId: null,
  preferredInstanceId: null,
  queue: [],
  loading: false,
  lastLaunchedInstanceId: null,

  fetchInstances: async () => {
    set({ loading: true })
    try {
      const instances = await api.server.list()
      set({ instances })
    } finally {
      set({ loading: false })
    }
  },

  startServer: async (profileId) => {
    const result = await api.server.start(profileId)
    await get().fetchInstances()
    return result
  },

  stopServer: async (instanceId) => {
    await api.server.stop(instanceId)
    await get().fetchInstances()
  },

  restartServer: async (instanceId) => {
    await api.server.restart(instanceId)
    await get().fetchInstances()
  },

  fetchLogs: async (instanceId) => {
    const lines = await api.server.getLogs(instanceId)
    set((s) => {
      const existing = s.logs[instanceId] ?? []
      // Race: IPC may already have buffered startup logs while getLogs() returns [] briefly.
      // Never replace a longer live buffer with a shorter/stale snapshot.
      if (lines.length < existing.length) {
        return s
      }
      return { logs: { ...s.logs, [instanceId]: lines } }
    })
  },

  selectInstance: (id) => set({ selectedInstanceId: id }),

  setPreferredInstance: (id) => set({ preferredInstanceId: id }),

  fetchQueue: async () => {
    const queue = await api.server.queueList()
    set({ queue })
  },

  cancelQueued: async (id) => {
    await api.server.queueCancel(id)
    await get().fetchQueue()
  },

  clearInstance: async (instanceId) => {
    await api.server.clearInstance(instanceId)
    set((s) => ({
      instances: s.instances.filter((i) => i.id !== instanceId),
      lastLaunchedInstanceId: s.lastLaunchedInstanceId === instanceId ? null : s.lastLaunchedInstanceId,
    }))
  },

  trackLaunchedInstance: (instanceId) => {
    set({ lastLaunchedInstanceId: instanceId })
  },

  onLogChunk: (line) => {
    const { instanceId } = line
    const existingBuf = logBuffers.get(instanceId)
    const replaceFirst = !!(line.replacesLast && !existingBuf?.length)
    bufferLogLine(instanceId, line)
    scheduleFlush(instanceId, replaceFirst)
  },

  onStateChange: ({ instanceId, state, pid }) => {
    flushImmediately(instanceId)
    if (state === 'stopped' || state === 'error') {
      const inst = get().instances.find((i) => i.id === instanceId)
      if (inst) clearTransportCache(inst.host, inst.port)
    }
    set((s) => ({
      // Remove stopped instances; keep errored ones so user can clear them
      instances:
        state === 'stopped'
          ? s.instances.filter((inst) => inst.id !== instanceId)
          : s.instances.map((inst) =>
              inst.id === instanceId
                ? { ...inst, state, pid: pid ?? inst.pid }
                : inst
            )
    }))
  },

  onQueueUpdate: ({ queue }) => {
    set({ queue })
  }
}))
