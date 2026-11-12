import { create } from 'zustand'
import { api } from '../lib/ipc'

type Theme = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'llamafront-theme'

function resolveEffectiveTheme(): Theme {
  return ((localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'system')
}

function applyTheme(t: Theme): void {
  // Apply CSS class to root element
  document.documentElement.classList.toggle('light', t === 'light')
  // Notify main process to update native window theme (affects title bar)
  api.settings.setTheme(t)
}

const initial: Theme = resolveEffectiveTheme()
applyTheme(initial)

// Listen for system color scheme changes when in system mode
const mql = window.matchMedia('(prefers-color-scheme: dark)')
const onSystemChange = (e: MediaQueryListEvent): void => {
  if (useThemeStore.getState().theme === 'system') {
    // Toggle the CSS class to match system preference
    document.documentElement.classList.toggle('light', !e.matches)
  }
}
mql.addEventListener('change', onSystemChange)

interface ThemeStore {
  theme: Theme
  setTheme: (t: Theme) => void
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: initial,
  setTheme: (t: Theme) => {
    localStorage.setItem(STORAGE_KEY, t)
    applyTheme(t)
    set({ theme: t })
  },
}))
