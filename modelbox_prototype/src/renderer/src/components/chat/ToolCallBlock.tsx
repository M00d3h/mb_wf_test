import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, ShieldCheck, ShieldOff, Wrench } from 'lucide-react'
import { useMCPStore } from '../../store/mcpStore'
import { cn } from '../../lib/utils'
import { useThemeStore } from '../../store/themeStore'

interface Props {
  /** The unique call id from the model */
  callId: string
  toolName: string
  serverName: string
  /** Raw JSON string of arguments */
  argsJson: string
  /** When true this block is already resolved (historical message) — no buttons shown */
  resolved?: boolean
  /** True once `<tool_result>` for this call id exists in the same message (live or final) */
  toolFinished?: boolean
}

export function ToolCallBlock({
  callId,
  toolName,
  serverName,
  argsJson,
  resolved,
  toolFinished,
}: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [executing, setExecuting] = useState(false)
  const { pendingCall, approvePending, alwaysApprovePending, denyPending } = useMCPStore()
  const { theme } = useThemeStore()

  const isPending = !resolved && pendingCall?.id === callId

  let prettyArgs = argsJson
  try {
    prettyArgs = JSON.stringify(JSON.parse(argsJson), null, 2)
  } catch { /* keep raw */ }

  const handleAllow = async (): Promise<void> => {
    if (!isPending) return
    setExecuting(true)
    // The actual execution happens inside requestApproval's promise resolution in mcpStore
    // We just resolve the pending promise — chatStore's onToolCall will call the IPC
    approvePending({ content: '', isError: false }) // content filled by IPC in chatStore
  }

  const handleAlwaysAllow = (): void => {
    if (!isPending) return
    alwaysApprovePending({ content: '', isError: false })
  }

  const handleDeny = (): void => {
    if (!isPending) return
    denyPending()
  }

  /** Spinner after Allow = tool IPC + stream until we see tool_result (not icon loading — icons are bundled). */
  useEffect(() => {
    if (resolved || toolFinished) setExecuting(false)
  }, [resolved, toolFinished])

  return (
    <div
      className={cn(
        'my-2 rounded-xl border text-sm overflow-hidden',
        isPending
          ? theme === 'light'
            ? 'border-amber-600/35 bg-amber-50/90 ring-1 ring-amber-700/10'
            : 'border-amber-500/40 bg-amber-500/[0.05]'
          : theme === 'light'
            ? 'border-neutral-200/90 bg-white/80'
            : 'border-zinc-700/50 bg-zinc-800/40',
        theme === 'light'
          ? 'shadow-[0_1px_2px_rgba(0,0,0,0.04)]'
          : 'shadow-[0_4px_24px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.06)]',
      )}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors',
          theme === 'light'
            ? isPending
              ? 'hover:bg-amber-100/60'
              : 'hover:bg-neutral-100/80'
            : 'hover:bg-white/[0.03]',
        )}
      >
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
            isPending
              ? theme === 'light'
                ? 'bg-amber-200/90 text-amber-900'
                : 'bg-amber-500/15 text-amber-400'
              : theme === 'light'
                ? 'bg-neutral-200/90 text-neutral-700'
                : 'bg-zinc-700/50 text-zinc-400',
          )}
        >
          {executing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wrench className="h-3.5 w-3.5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'font-medium',
              theme === 'light' ? 'text-neutral-900' : 'text-zinc-200',
            )}
          >
            {toolName}
          </span>
          <span
            className={cn(
              'ml-1.5 text-xs',
              theme === 'light' ? 'text-neutral-600' : 'text-zinc-500',
            )}
          >
            via {serverName}
          </span>
        </span>
        {isPending && !executing && (
          <span
            className={cn(
              'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
              theme === 'light'
                ? 'bg-amber-100 text-amber-950 ring-amber-700/20'
                : 'bg-amber-500/20 text-amber-400 ring-amber-400/15',
            )}
          >
            Awaiting approval
          </span>
        )}
        <span
          className={cn(
            'shrink-0',
            theme === 'light' ? 'text-neutral-500' : 'text-zinc-600',
          )}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      {/* Args */}
      {expanded && (
        <div
          className={cn(
            'border-t px-3 pb-2 pt-2',
            theme === 'light' ? 'border-neutral-200/90' : 'border-zinc-700/40',
          )}
        >
          <p
            className={cn(
              'mb-1 text-[11px] font-medium uppercase tracking-wide',
              theme === 'light' ? 'text-neutral-600' : 'text-zinc-600',
            )}
          >
            Arguments
          </p>
          <pre
            className={cn(
              'max-h-48 overflow-auto rounded-lg p-2.5 text-[12px] leading-relaxed font-mono whitespace-pre-wrap break-all',
              theme === 'light'
                ? 'bg-neutral-100/90 text-neutral-900'
                : 'bg-zinc-900/60 text-zinc-300',
            )}
          >
            {prettyArgs}
          </pre>
        </div>
      )}

      {/* Action buttons — only on pending call */}
      {isPending && !executing && (
        <div
          className={cn(
            'flex items-center gap-2 border-t px-3 py-2',
            theme === 'light' ? 'border-neutral-200/90' : 'border-zinc-700/40',
          )}
        >
          <button
            type="button"
            onClick={() => { void handleAllow() }}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              theme === 'light'
                ? 'bg-cyan-500/15 text-cyan-800 hover:bg-cyan-500/25'
                : 'bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500/25',
            )}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Allow
          </button>
          <button
            type="button"
            onClick={handleAlwaysAllow}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              theme === 'light'
                ? 'bg-emerald-500/15 text-emerald-800 hover:bg-emerald-500/25'
                : 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25',
            )}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Always Allow
          </button>
          <button
            type="button"
            onClick={handleDeny}
            className={cn(
              'ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              theme === 'light'
                ? 'bg-neutral-200/90 text-neutral-800 hover:bg-neutral-300/90'
                : 'bg-zinc-700/40 text-zinc-400 hover:bg-zinc-700/70',
            )}
          >
            <ShieldOff className="h-3.5 w-3.5" />
            Deny
          </button>
        </div>
      )}
    </div>
  )
}
