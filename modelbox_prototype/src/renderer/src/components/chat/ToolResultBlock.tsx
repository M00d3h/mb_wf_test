import { useState } from 'react'
import { ChevronDown, ChevronRight, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useThemeStore } from '../../store/themeStore'

interface Props {
  toolCallId: string
  content: string
  isError: boolean
}

export function ToolResultBlock({ toolCallId: _toolCallId, content, isError }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const { theme } = useThemeStore()

  const preview = content.slice(0, 120) + (content.length > 120 ? '…' : '')

  return (
    <div
      className={cn(
        'my-1 rounded-xl border text-sm overflow-hidden',
        isError ? 'border-red-500/30 bg-red-500/[0.04]' : 'border-emerald-500/25 bg-emerald-500/[0.04]',
        theme === 'light' && 'shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.03] transition-colors"
      >
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center',
            isError ? 'text-red-400' : 'text-emerald-400',
          )}
        >
          {isError ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        </span>
        <span className={cn('min-w-0 flex-1 truncate text-xs', isError ? 'text-red-300' : 'text-zinc-400')}>
          {expanded ? 'Result' : preview}
        </span>
        <span className="shrink-0 text-zinc-600">
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-zinc-700/30 px-3 pb-2 pt-2">
          <pre className="max-h-64 overflow-auto rounded-lg bg-zinc-900/60 p-2.5 text-[12px] leading-relaxed text-zinc-300 font-mono whitespace-pre-wrap break-all">
            {content || '(empty)'}
          </pre>
        </div>
      )}
    </div>
  )
}
