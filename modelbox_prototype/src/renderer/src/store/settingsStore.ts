import { create } from 'zustand'
import { api } from '../lib/ipc'
import type { AppSettings } from '@shared/types'

interface SettingsStore {
  settings: AppSettings | null
  loading: boolean
  fetch: () => Promise<void>
  update: (patch: Partial<AppSettings>) => Promise<void>
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: null,
  loading: false,

  fetch: async () => {
    set({ loading: true })
    try {
      const settings = await api.settings.get()
      set({ settings })
    } finally {
      set({ loading: false })
    }
  },

  update: async (patch) => {
    const settings = await api.settings.set(patch)
    set({ settings })
    if (patch.modelsDirs !== undefined) {
      const { useModelsStore } = await import('./modelsStore')
      void useModelsStore.getState().scanModels()
    }
    if (patch.vllmModelDirs !== undefined) {
      const { useVllmStore } = await import('./vllmStore')
      void useVllmStore.getState().scan()
    }
  }
}))
