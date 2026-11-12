import { cn } from '../../lib/utils'
import { useThemeStore } from '../../store/themeStore'

interface Props {
  label: string
  variant?: 'default' | 'moe' | 'embed' | 'mm' | 'quant' | 'incomplete'
}

const darkStyles: Record<string, string> = {
  default: 'bg-zinc-700/50 text-zinc-300',
  moe: 'bg-cyan-500/20 text-cyan-300',
  embed: 'bg-blue-500/20 text-blue-300',
  mm: 'bg-teal-500/20 text-teal-300',
  quant: 'bg-orange-500/20 text-orange-300',
  incomplete: 'bg-amber-500/20 text-amber-300',
}

const lightStyles: Record<string, string> = {
  default: 'bg-zinc-200 text-zinc-600',
  moe: 'bg-cyan-100 text-cyan-700',
  embed: 'bg-blue-100 text-blue-700',
  mm: 'bg-teal-100 text-teal-700',
  quant: 'bg-orange-100 text-orange-700',
  incomplete: 'bg-amber-100 text-amber-700',
}

export function TagChip({ label, variant = 'default' }: Props): JSX.Element {
  const { theme } = useThemeStore()
  const styles = theme === 'light' ? lightStyles : darkStyles
  return (
    <span
      className={cn(
        'inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide',
        styles[variant]
      )}
    >
      {label}
    </span>
  )
}
