import { create } from 'zustand'

type UpdateStore = {
  phase: 'idle' | 'available'
  dismissed: boolean
  currentVersion: string
  latestVersion: string
  releaseUrl: string
  downloadUrl: string | null
  setCurrentVersion: (v: string) => void
  setAvailable: (result: { currentVersion: string; latestVersion: string; releaseUrl: string; downloadUrl: string | null }) => void
  dismissFloating: () => void
  dismiss: () => void
}

export const useUpdateStore = create<UpdateStore>((set) => ({
  phase: 'idle',
  dismissed: false,
  currentVersion: '',
  latestVersion: '',
  releaseUrl: '',
  downloadUrl: null,
  setCurrentVersion: (currentVersion) => set({ currentVersion }),
  setAvailable: ({ currentVersion, latestVersion, releaseUrl, downloadUrl }) =>
    set({ phase: 'available', dismissed: false, currentVersion, latestVersion, releaseUrl, downloadUrl }),
  dismissFloating: () => set({ dismissed: true }),
  dismiss: () => set({ phase: 'idle', dismissed: false }),
}))
