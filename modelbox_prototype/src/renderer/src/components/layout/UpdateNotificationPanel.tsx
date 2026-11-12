import { ArrowUp, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useUpdateStore } from '../../store/updateStore'
import { useThemeStore } from '../../store/themeStore'
import { api } from '../../lib/ipc'

const BUBBLE_SIZE = 56
const RING_STROKE = 3
const RING_R = (BUBBLE_SIZE - RING_STROKE * 2) / 2
const RING_CIRC = 2 * Math.PI * RING_R

const flyoutPanel =
  'rounded-2xl border border-zinc-700/80 bg-zinc-950 text-zinc-100 shadow-2xl shadow-black/40 ring-1 ring-zinc-800/90'

export function UpdateNotificationPanel(): JSX.Element | null {
  const { phase, dismissed, currentVersion, latestVersion, releaseUrl, downloadUrl, dismissFloating, dismiss } = useUpdateStore()
  const { theme } = useThemeStore()

  if (phase === 'idle' || dismissed) return null

  const isExpanded = true

  const ringColor = 'rgb(34,197,94)'
  const ringGlow = 'rgba(34,197,94,0.55)'
  const accentColorDark = 'rgba(34,197,94,0.12)'

  const handleDownload = (): void => {
    void api.update.openRelease(downloadUrl ?? releaseUrl)
    dismiss()
  }

  const handleLater = (): void => {
    dismissFloating()
  }

  return (
    <div
      className="fixed bottom-4 right-2 z-[200]"
      style={{ width: BUBBLE_SIZE, height: BUBBLE_SIZE }}
    >
      {/* Expanded card — grows upward from bottom-right */}
      <div
        className="absolute bottom-0 right-0"
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
          <div className="mb-2.5 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-zinc-100">Update available</p>
              <p className="mt-0.5 text-[11px] text-zinc-400">
                v{latestVersion} is out
                {currentVersion ? ` — you have v${currentVersion}` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={handleLater}
              className={cn(
                'shrink-0 rounded-full p-1 text-zinc-500 transition-colors',
                theme === 'light'
                  ? 'hover:bg-black/[0.06] hover:text-zinc-700'
                  : 'hover:bg-white/[0.06] hover:text-zinc-200',
              )}
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleDownload}
              className={cn(
                'flex-1 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition-colors',
                theme === 'light'
                  ? 'border-emerald-600/40 bg-emerald-50 text-emerald-700 hover:border-emerald-600/60 hover:bg-emerald-100'
                  : 'border-emerald-500/30 bg-emerald-950/40 text-emerald-300 hover:border-emerald-500/50 hover:bg-emerald-500/10',
              )}
            >
              Download
            </button>
            <button
              type="button"
              onClick={handleLater}
              className={cn(
                'flex-1 rounded-lg border px-3 py-1.5 text-[11px] font-medium transition-colors',
                theme === 'light'
                  ? 'border-zinc-300 bg-zinc-50 text-zinc-600 hover:bg-zinc-100'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300',
              )}
            >
              Later
            </button>
          </div>
        </div>
      </div>

      {/* Collapsed bubble (hidden while expanded, kept for entry/exit animation symmetry) */}
      <div
        className="absolute bottom-0 right-0 cursor-pointer"
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
                ? '0 0 0 1px rgba(0,0,0,0.1), 0 8px 28px rgba(0,0,0,0.14)'
                : `0 0 0 1px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.55), 0 0 24px ${accentColorDark}`,
          }}
        >
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
              strokeDashoffset={0}
              style={{ filter: `drop-shadow(0 0 5px ${ringGlow})` }}
            />
          </svg>
          <ArrowUp
            className={cn('relative z-10 h-5 w-5', theme === 'light' ? 'text-emerald-600' : 'text-emerald-400')}
            aria-hidden
          />
        </div>
      </div>
    </div>
  )
}
