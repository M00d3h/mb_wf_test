import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useVllmSetupStore } from '../../store/vllmSetupStore'
import { useThemeStore } from '../../store/themeStore'
import vllmColorIcon from '../../assets/vllm-color.svg'

const BUBBLE_SIZE = 56
const RING_STROKE = 3
const RING_R = (BUBBLE_SIZE - RING_STROKE * 2) / 2
const RING_CIRC = 2 * Math.PI * RING_R

const flyoutPanel =
  'rounded-2xl border border-zinc-700/80 bg-zinc-950 text-zinc-100 shadow-2xl shadow-black/40 ring-1 ring-zinc-800/90'

export function VllmSetupFloatingPanel(): JSX.Element | null {
  const { phase, lines, distro, error, dismiss, startSetup, confirmVenvInstall } = useVllmSetupStore()
  const { theme } = useThemeStore()
  const [hovered, setHovered] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onEnter = (): void => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setHovered(true)
  }
  const onLeave = (): void => {
    hoverTimer.current = setTimeout(() => setHovered(false), 80)
  }

  if (phase === 'idle') return null

  const isRunning = phase === 'running'
  const isComplete = phase === 'complete'
  const isError = phase === 'error'
  const isConfirming = phase === 'needs-venv-confirm'
  const isExpanded = hovered || isConfirming

  const ringColor = isComplete
    ? 'rgb(34,197,94)'
    : isError
      ? 'rgb(244,63,94)'
      : isConfirming
        ? 'rgb(251,191,36)'
        : 'rgb(34,211,238)'

  const ringGlow = isComplete
    ? 'rgba(34,197,94,0.55)'
    : isError
      ? 'rgba(244,63,94,0.55)'
      : isConfirming
        ? 'rgba(251,191,36,0.55)'
        : 'rgba(34,211,238,0.55)'

  const accentColorDark = isComplete
    ? 'rgba(34,197,94,0.12)'
    : isError
      ? 'rgba(244,63,94,0.12)'
      : isConfirming
        ? 'rgba(251,191,36,0.12)'
        : 'rgba(34,211,238,0.14)'

  // Running: spin the ring (full circle, pulsing via animation)
  // Complete/error: show full or empty ring
  const dashoffset = isRunning ? 0 : isComplete ? 0 : RING_CIRC

  const last20 = lines.slice(-20)
  const statusLabel = isRunning
    ? 'Installing vLLM…'
    : isComplete
      ? 'vLLM installed'
      : isConfirming
        ? 'Action required'
        : error ?? 'Setup failed'

  return (
    <div
      className="fixed bottom-4 right-2 z-[200]"
      style={{ width: BUBBLE_SIZE, height: BUBBLE_SIZE }}
    >
      {/* Expanded flyout panel — grows upward */}
      <div
        className="absolute bottom-0 right-0"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={{
          transformOrigin: 'bottom right',
          opacity: isExpanded ? 1 : 0,
          transform: isExpanded ? 'scale(1) translateY(0px)' : 'scale(0.82) translateY(8px)',
          transition: isExpanded
            ? 'opacity 180ms ease-out, transform 420ms cubic-bezier(0.34,1.56,0.64,1)'
            : 'opacity 130ms ease-in, transform 200ms cubic-bezier(0.4,0,0.2,1)',
          pointerEvents: isExpanded ? 'auto' : 'none',
        }}
      >
        <div className={cn('relative z-50 w-[min(20rem,calc(100vw-2rem))] p-3 backdrop-blur-sm', flyoutPanel)}>
          {/* Header */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <p className="text-xs font-semibold text-zinc-200 truncate">vLLM Setup</p>
              {distro && (
                <span className="shrink-0 text-[10px] font-medium bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded-full">
                  {distro}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={dismiss}
              className={cn(
                'shrink-0 rounded-full p-1 text-zinc-500 transition-colors',
                theme === 'light'
                  ? 'hover:bg-black/[0.06] hover:text-zinc-200'
                  : 'hover:bg-white/[0.06] hover:text-zinc-200',
              )}
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* python3-venv confirmation prompt */}
          {isConfirming && (
            <div className="mb-2 rounded-lg border border-amber-500/20 bg-amber-950/20 p-2.5">
              <p className="text-[11px] text-zinc-300 leading-relaxed mb-2.5">
                <span className="font-semibold text-amber-300">python3-venv</span> is required but not installed.
                Install it now to continue?
              </p>
              <button
                type="button"
                onClick={() => void confirmVenvInstall()}
                className={cn(
                  'w-full rounded-md border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                  theme === 'light'
                    ? 'border-cyan-600/40 bg-cyan-50 text-cyan-700 hover:bg-cyan-100'
                    : 'border-cyan-500/30 bg-cyan-950/40 text-cyan-200 hover:border-cyan-500/50 hover:bg-cyan-500/10',
                )}
              >
                Install python3-venv and continue
              </button>
            </div>
          )}

          {/* Log lines */}
          {last20.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-lg bg-zinc-900/80 p-2 mb-2">
              {last20.map((line, i) => (
                <p key={i} className="font-mono text-[10px] leading-relaxed text-zinc-400 break-all whitespace-pre-wrap">
                  {line.replace(/\n$/, '')}
                </p>
              ))}
            </div>
          )}

          {/* Status footer */}
          <div className="flex items-center justify-between gap-2">
            <p
              className={cn(
                'text-[11px] font-medium',
                isComplete ? 'text-emerald-400' : isError ? 'text-rose-400' : isConfirming ? 'text-amber-400' : 'text-zinc-400',
              )}
            >
              {statusLabel}
            </p>
            {!isConfirming && (isError || phase === 'interrupted') && (
              <button
                type="button"
                onClick={() => void startSetup()}
                className={cn(
                  'shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
                  theme === 'light'
                    ? 'border-cyan-600/40 bg-cyan-50 text-cyan-700 hover:border-cyan-600/60 hover:bg-cyan-100'
                    : 'border-cyan-500/30 bg-cyan-950/40 text-cyan-300 hover:border-cyan-500/50 hover:bg-cyan-500/10',
                )}
              >
                {phase === 'interrupted' ? 'Resume' : 'Retry'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Collapsed bubble */}
      <div
        className="absolute bottom-0 right-0 cursor-pointer"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={{
          opacity: isExpanded ? 0 : 1,
          transform: isExpanded ? 'scale(0.55)' : 'scale(1)',
          transition: isExpanded
            ? 'opacity 120ms ease-in, transform 170ms ease-in'
            : 'opacity 230ms 90ms ease-out, transform 400ms cubic-bezier(0.34,1.56,0.64,1)',
          pointerEvents: isExpanded ? 'none' : 'auto',
        }}
      >
        <div
          className="relative flex items-center justify-center rounded-full"
          style={{
            width: BUBBLE_SIZE,
            height: BUBBLE_SIZE,
            background: theme === 'light' ? 'rgba(255,255,255,0.97)' : 'rgba(20,20,23,0.97)',
            boxShadow:
              theme === 'light'
                ? `0 0 0 1px rgba(0,0,0,0.1), 0 8px 28px rgba(0,0,0,0.14)`
                : `0 0 0 1px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.55), 0 0 24px ${accentColorDark}`,
          }}
        >
          {/* Progress ring */}
          <svg
            width={BUBBLE_SIZE}
            height={BUBBLE_SIZE}
            className="absolute inset-0"
            style={{ transform: 'rotate(-90deg)' }}
            aria-hidden
          >
            <circle
              cx={BUBBLE_SIZE / 2}
              cy={BUBBLE_SIZE / 2}
              r={RING_R}
              fill="none"
              stroke={theme === 'light' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)'}
              strokeWidth={RING_STROKE}
            />
            <circle
              cx={BUBBLE_SIZE / 2}
              cy={BUBBLE_SIZE / 2}
              r={RING_R}
              fill="none"
              stroke={ringColor}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_CIRC}
              strokeDashoffset={dashoffset}
              style={{
                transition: 'stroke-dashoffset 400ms ease-out',
                filter: `drop-shadow(0 0 5px ${ringGlow})`,
                ...(isRunning
                  ? { animation: 'vllm-ring-spin 1.4s linear infinite', strokeDashoffset: RING_CIRC * 0.25 }
                  : {}),
              }}
            />
          </svg>

          {/* vLLM logo — always shown, opacity/filter indicates state */}
          <img
            src={vllmColorIcon}
            className="relative z-10 h-6 w-6"
            style={{
              opacity: isError ? 0.45 : 1,
              filter: isError ? 'grayscale(0.6)' : undefined,
            }}
            aria-hidden
          />
        </div>
      </div>

      {/* Keyframe for ring spin */}
      <style>{`
        @keyframes vllm-ring-spin {
          from { stroke-dashoffset: ${RING_CIRC}; }
          to { stroke-dashoffset: ${-RING_CIRC}; }
        }
      `}</style>
    </div>
  )
}
