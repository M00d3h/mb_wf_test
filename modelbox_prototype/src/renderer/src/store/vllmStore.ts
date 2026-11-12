import { create } from "zustand";
import { api } from "../lib/ipc";
import type { VllmModel, VllmModelConfig, VllmProfile } from "@shared/types";

interface VllmStore {
  models: VllmModel[];
  /** Populated on scan when paths are unreadable or no weights found. */
  scanWarnings: string[];
  profiles: Record<string, VllmProfile[]>;
  loading: boolean;
  fetchList: () => Promise<void>;
  scan: () => Promise<void>;
  update: (
    id: string,
    patch: { displayName?: string; config?: Partial<VllmModelConfig> },
  ) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  fetchProfiles: (vllmModelId: string) => Promise<void>;
  createProfile: (
    vllmModelId: string,
    name: string,
    config: VllmModelConfig,
  ) => Promise<VllmProfile>;
  updateProfile: (
    id: string,
    patch: { name?: string; config?: VllmModelConfig },
  ) => Promise<VllmProfile>;
  deleteProfile: (id: string, vllmModelId: string) => Promise<void>;
  setActiveProfile: (id: string, vllmModelId: string) => Promise<void>;
  duplicateProfile: (id: string, vllmModelId: string) => Promise<VllmProfile>;
  applyCustomCommandLine: (id: string, line: string) => Promise<VllmProfile>;
}

export const useVllmStore = create<VllmStore>((set, get) => ({
  models: [],
  scanWarnings: [],
  profiles: {},
  loading: false,

  fetchList: async () => {
    set({ loading: true });
    try {
      const models = await api.vllm.list();
      set({ models, scanWarnings: [] });
    } finally {
      set({ loading: false });
    }
  },

  scan: async () => {
    set({ loading: true, scanWarnings: [] });
    try {
      const result = await api.vllm.scan();
      set({ models: result.models, scanWarnings: result.warnings });
    } finally {
      set({ loading: false });
    }
  },

  update: async (id, patch) => {
    const m = await api.vllm.update(id, patch);
    if (m) {
      set((s) => ({
        models: s.models.map((x) => (x.id === id ? m : x)),
      }));
    }
  },

  deleteModel: async (id) => {
    await api.vllm.delete(id);
    set((s) => ({
      models: s.models.filter((x) => x.id !== id),
      profiles: Object.fromEntries(
        Object.entries(s.profiles).filter(([k]) => k !== id),
      ),
    }));
  },

  fetchProfiles: async (vllmModelId) => {
    const profiles = await api.vllm.profiles.list(vllmModelId);
    set((s) => ({
      profiles: { ...s.profiles, [vllmModelId]: profiles },
    }));
  },

  createProfile: async (vllmModelId, name, config) => {
    const profile = await api.vllm.profiles.create(vllmModelId, name, config);
    await get().fetchProfiles(vllmModelId);
    return profile;
  },

  updateProfile: async (id, patch) => {
    const profile = await api.vllm.profiles.update(id, patch);
    await get().fetchProfiles(profile.vllmModelId);
    return profile;
  },

  deleteProfile: async (id, vllmModelId) => {
    await api.vllm.profiles.delete(id);
    await get().fetchProfiles(vllmModelId);
  },

  setActiveProfile: async (id, vllmModelId) => {
    await api.vllm.profiles.setActive(id);
    await get().fetchProfiles(vllmModelId);
    await get().fetchList();
  },

  duplicateProfile: async (id, vllmModelId) => {
    const profile = await api.vllm.profiles.duplicate(id);
    await get().fetchProfiles(vllmModelId);
    return profile;
  },

  applyCustomCommandLine: async (id, line) => {
    const profile = await api.vllm.profiles.applyCustomCommandLine(id, line);
    await get().fetchProfiles(profile.vllmModelId);
    return profile;
  },
}));
