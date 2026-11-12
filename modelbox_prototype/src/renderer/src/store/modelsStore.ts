import { create } from 'zustand'
import { api } from '../lib/ipc'
import type { Model, Profile } from '@shared/types'
import { useServerStore } from './serverStore'

interface ModelsStore {
  models: Model[]
  selectedModelId: string | null
  profiles: Record<string, Profile[]> // modelId → profiles
  scanning: boolean
  loading: boolean

  fetchModels: () => Promise<void>
  scanModels: () => Promise<void>
  selectModel: (id: string | null) => void
  fetchProfiles: (modelId: string) => Promise<void>
  createProfile: (
    modelId: string,
    name: string,
    config: Profile['config'],
    apiKey?: string
  ) => Promise<Profile>
  updateProfile: (
    id: string,
    patch: { name?: string; config?: Profile['config']; apiKey?: string | null }
  ) => Promise<Profile>
  deleteProfile: (id: string, modelId: string) => Promise<void>
  setActiveProfile: (id: string, modelId: string) => Promise<void>
  duplicateProfile: (id: string, modelId: string) => Promise<Profile>
  applyCustomCommandLine: (id: string, line: string) => Promise<Profile>
  deleteModel: (modelId: string) => Promise<void>
}

export const useModelsStore = create<ModelsStore>((set, get) => ({
  models: [],
  selectedModelId: null,
  profiles: {},
  scanning: false,
  loading: false,

  fetchModels: async () => {
    set({ loading: true })
    try {
      const models = await api.models.list()
      set({ models })
    } finally {
      set({ loading: false })
    }
  },

  scanModels: async () => {
    set({ scanning: true })
    try {
      const models = await api.models.scan()
      set({ models })
    } finally {
      set({ scanning: false })
    }
  },

  selectModel: (id) => set({ selectedModelId: id }),

  fetchProfiles: async (modelId) => {
    const profiles = await api.profiles.list(modelId)
    set((s) => ({ profiles: { ...s.profiles, [modelId]: profiles } }))
  },

  createProfile: async (modelId, name, config, apiKey) => {
    const profile = await api.profiles.create(modelId, name, config, apiKey)
    await get().fetchProfiles(modelId)
    return profile
  },

  updateProfile: async (id, patch) => {
    const profile = await api.profiles.update(id, patch)
    const modelId = profile.modelId
    await get().fetchProfiles(modelId)
    return profile
  },

  deleteProfile: async (id, modelId) => {
    await api.profiles.delete(id)
    await get().fetchProfiles(modelId)
  },

  setActiveProfile: async (id, modelId) => {
    await api.profiles.setActive(id)
    await get().fetchProfiles(modelId)
  },

  duplicateProfile: async (id, modelId) => {
    const profile = await api.profiles.duplicate(id)
    await get().fetchProfiles(modelId)
    return profile
  },

  applyCustomCommandLine: async (id, line) => {
    const profile = await api.profiles.applyCustomCommandLine(id, line)
    await get().fetchProfiles(profile.modelId)
    return profile
  },

  deleteModel: async (modelId) => {
    await api.models.delete(modelId)
    if (get().selectedModelId === modelId) {
      set({ selectedModelId: null })
    }
    set((s) => {
      const { [modelId]: _removed, ...profiles } = s.profiles
      return { profiles }
    })
    await get().fetchModels()
    await useServerStore.getState().fetchInstances()
  },
}))
