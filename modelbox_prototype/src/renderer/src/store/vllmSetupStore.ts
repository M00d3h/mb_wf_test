import { create } from 'zustand'
import { api } from '../lib/ipc'
import { useSettingsStore } from './settingsStore'
import { useVllmStore } from './vllmStore'
import type { VllmRuntimeInfo, RuntimeProgressEvent, VllmSetupMeta } from '@shared/types'

const MAX_LINES = 60

interface VllmSetupStore {
  phase: 'idle' | 'interrupted' | 'running' | 'needs-venv-confirm' | 'complete' | 'error'
  lines: string[]
  distro: string | null
  error: string | null
  info: VllmRuntimeInfo | null
  /** Authoritative install status fetched at startup (and updated after setup). */
  runtimeInfo: VllmRuntimeInfo | null
  markInterrupted: (meta: VllmSetupMeta) => void
  setRuntimeInfo: (info: VllmRuntimeInfo) => void
  startSetup: () => Promise<void>
  confirmVenvInstall: () => Promise<void>
  dismiss: () => void
}

export const useVllmSetupStore = create<VllmSetupStore>((set, get) => ({
  phase: 'idle',
  lines: [],
  distro: null,
  error: null,
  info: null,
  runtimeInfo: null,

  markInterrupted: (meta: VllmSetupMeta): void => {
    set({ phase: 'interrupted', distro: meta.distro ?? null, lines: [], error: null, info: null })
  },

  setRuntimeInfo: (info: VllmRuntimeInfo): void => {
    set({ runtimeInfo: info })
  },

  startSetup: async (): Promise<void> => {
    const currentPhase = get().phase
    if (currentPhase !== 'idle' && currentPhase !== 'interrupted') return

    set({ phase: 'running', lines: [], distro: null, error: null, info: null })

    const unsub = api.on('runtime:progress', (...args: unknown[]) => {
      const event = args[1] as RuntimeProgressEvent
      if (event.kind !== 'vllm') return

      if (event.phase === 'env-check') {
        set({ distro: event.distro ?? null })
      } else if (event.phase === 'needs-venv-confirm') {
        set({ phase: 'needs-venv-confirm' })
      } else if (event.phase === 'dirs-set') {
        // Models are embedded in the event — no IPC round-trip needed.
        useVllmStore.setState({ models: event.models, scanWarnings: [] })
        void useSettingsStore.getState().fetch()
      } else if (event.phase === 'pip-install') {
        set((s) => ({ lines: [...s.lines, event.line].slice(-MAX_LINES) }))
      } else if (event.phase === 'complete') {
        useVllmStore.setState({ models: event.models, scanWarnings: [] })
        set({ phase: 'complete', info: event.info, runtimeInfo: event.info })
        unsub()
        void useSettingsStore.getState().fetch()
        void useVllmStore.getState().scan()
      } else if (event.phase === 'error') {
        set({ phase: 'error', error: event.error })
        unsub()
      }
    })

    try {
      await api.runtime.setupVllm()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ phase: 'error', error: msg })
      unsub()
    }
  },

  confirmVenvInstall: async (): Promise<void> => {
    set({ phase: 'running' })
    await api.runtime.respondVenvConfirm(true)
  },

  dismiss: (): void => {
    if (get().phase === 'needs-venv-confirm') {
      void api.runtime.respondVenvConfirm(false)
    }
    set({ phase: 'idle', lines: [], distro: null, error: null, info: null })
  },
}))
