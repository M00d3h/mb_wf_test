import { cn } from '../../lib/utils'
import { useThemeStore } from '../../store/themeStore'
import type { ServerState } from '@shared/types'

interface Props {
  state: ServerState | 'unknown'
  className?: string
}

export type ServerStateBadgeConfig = {
  label: string
  dark: string
  light: string
  dot: string
}

/** Shared with LaunchModelProfileButton so launch states match model-card StatusBadge styling. */
export const serverStateBadgeConfig: Record<string, ServerStateBadgeConfig> = {
  starting: {
    label: 'Starting',
    dark: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    light: 'bg-yellow-100 text-yellow-700 border-yellow-300',
    dot: 'bg-yellow-400 animate-pulse'
  },
  loading: {
    label: 'Loading',
    dark: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    light: 'bg-blue-100 text-blue-700 border-blue-300',
    dot: 'bg-blue-400 animate-pulse'
  },
  'vllm-shards': {
    label: 'Loading shards',
    dark: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
    light: 'bg-indigo-100 text-indigo-700 border-indigo-300',
    dot: 'bg-indigo-400 animate-pulse'
  },
  'vllm-compile': {
    label: 'Compiling',
    dark: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    light: 'bg-purple-100 text-purple-700 border-purple-300',
    dot: 'bg-purple-400 animate-pulse'
  },
  'vllm-cudagraph': {
    label: 'Cuda graph',
    dark: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    light: 'bg-cyan-100 text-cyan-700 border-cyan-300',
    dot: 'bg-cyan-400 animate-pulse'
  },
  running: {
    label: 'Running',
    dark: 'bg-green-500/15 text-green-400 border-green-500/30',
    light: 'bg-green-100 text-green-700 border-green-300',
    dot: 'bg-green-500'
  },
  stopped: {
    label: 'Stopped',
    dark: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    // Inverted zinc: use high zinc-* for light surfaces (zinc-100 reads as dark).
    light: 'bg-zinc-950/65 text-black border-zinc-700/25',
    dot: 'bg-zinc-400'
  },
  error: {
    label: 'Error',
    dark: 'bg-red-500/15 text-red-400 border-red-500/30',
    light: 'bg-red-100 text-red-700 border-red-300',
    dot: 'bg-red-500'
  },
  unknown: {
    label: 'Unknown',
    dark: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    light: 'bg-zinc-950/65 text-zinc-700 border-zinc-700/25',
    dot: 'bg-zinc-400'
  }
}

export function StatusBadge({ state, className }: Props): JSX.Element {
  const { theme } = useThemeStore()
  const cfg = serverStateBadgeConfig[state] ?? serverStateBadgeConfig.unknown
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-sm font-medium border',
        theme === 'light' ? cfg.light : cfg.dark,
        className
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
      {cfg.label}
    </span>
  )
}
