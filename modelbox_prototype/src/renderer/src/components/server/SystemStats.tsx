import { useEffect, useState } from 'react'
import { api } from '../../lib/ipc'
import { cn } from '../../lib/utils'
import { useThemeStore } from '../../store/themeStore'
import type { SystemStats } from '@shared/types'

/** Keeps gauges from flashing 0 when leaving Server and returning (panel unmounts). */
let lastSystemStats: SystemStats | null = null

function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
}

interface GaugeBarData {
  percent: number
  label?: string
  detail?: string
  secondaryPercent?: number
  secondaryDetail?: string
}

interface GaugeProps {
  label: string
  bars: GaugeBarData[]
  barColor: string
  textColor: string
  unavailable?: boolean
  unavailableLabel?: string
  secondaryBarColor?: string
}

function Gauge({
  label,
  bars,
  barColor,
  textColor,
  unavailable,
  unavailableLabel = 'nvidia-smi not found',
  secondaryBarColor = 'bg-orange-500'
}: GaugeProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2.5 min-w-0 h-full">
      {bars.length <= 1 ? (
        // Original tight layout for single-bar cases (Single GPU, CPU, RAM)
        <>
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="text-sm font-semibold text-zinc-300 uppercase tracking-widest shrink-0">
                {label}
              </span>
              {bars[0]?.label && (
                <span className="text-[10px] text-zinc-400 uppercase truncate font-medium pt-0.5">
                  - {bars[0].label}
                </span>
              )}
            </div>
            {unavailable ? (
              <span className="text-sm text-zinc-500 shrink-0">N/A</span>
            ) : (
              <span className={cn('text-sm font-bold tabular-nums shrink-0', textColor)}>
                {Math.round(bars[0]?.percent ?? 0)}%
              </span>
            )}
          </div>

          <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
            {!unavailable && (
              <div
                className={cn('h-full rounded-full transition-all duration-700', barColor)}
                style={{ width: `${Math.min(bars[0]?.percent ?? 0, 100)}%` }}
              />
            )}
          </div>

          <span className="text-xs text-zinc-200 font-mono truncate h-4">
            {unavailable ? unavailableLabel : (bars[0]?.detail ?? '')}
          </span>

          {bars[0]?.secondaryPercent !== undefined && (
            <div className="flex flex-col items-end gap-0.5 mt-auto">
              <div className="w-1/3 h-1 bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all duration-700', secondaryBarColor)}
                  style={{ width: `${Math.min(bars[0].secondaryPercent, 100)}%` }}
                />
              </div>
              {bars[0].secondaryDetail && (
                <span className="text-xs text-zinc-200 font-mono truncate max-w-full">
                  {bars[0].secondaryDetail}
                </span>
              )}
            </div>
          )}
        </>
      ) : (
        // Multi-bar layout for Multi-GPU
        <>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-sm font-semibold text-zinc-300 uppercase tracking-widest">
              {label}
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {bars.map((bar, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-zinc-400 uppercase truncate flex-1">
                    {bar.label}
                  </span>
                  <span className={cn('text-sm font-bold tabular-nums', textColor)}>
                    {Math.round(bar.percent)}%
                  </span>
                </div>
                <div className="h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all duration-700', barColor)}
                    style={{ width: `${Math.min(bar.percent, 100)}%` }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 h-4">
                  <span className="text-xs text-zinc-200 font-mono truncate">
                    {bar.detail ?? ''}
                  </span>
                </div>
                {bar.secondaryPercent !== undefined && (
                  <div className="flex flex-col items-end gap-0.5 mt-0.5">
                    <div className="w-1/3 h-1 bg-zinc-700 rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all duration-700', secondaryBarColor)}
                        style={{ width: `${Math.min(bar.secondaryPercent, 100)}%` }}
                      />
                    </div>
                    {bar.secondaryDetail && (
                      <span className="text-xs text-zinc-200 font-mono truncate max-w-full">
                        {bar.secondaryDetail}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function SystemStatsPanel(): JSX.Element {
  const { theme } = useThemeStore()
  const isLight = theme === 'light'
  const [stats, setStats] = useState<SystemStats | null>(
    () => lastSystemStats,
  )

  useEffect(() => {
    let cancelled = false

    const poll = async (): Promise<void> => {
      try {
        const s = await api.system.getStats()
        if (!cancelled) {
          lastSystemStats = s
          setStats(s)
        }
      } catch {
        // silently ignore if IPC fails
      }
    }

    poll()
    const timer = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const gpus = stats?.gpu ?? null
  const cpu = stats?.cpu
  const ram = stats?.ram
  const isMac = stats?.platform === 'darwin'
  const macGpuPercent = stats?.macGpuPercent

  if (isMac) {
    return (
      <div className="grid grid-cols-3 gap-2 px-3 sm:px-4 py-3 bg-gradient-to-b from-zinc-900/30 to-transparent">
        <Gauge
          label="GPU"
          bars={macGpuPercent !== undefined ? [{ percent: macGpuPercent }] : []}
          barColor={isLight ? 'bg-emerald-500' : 'bg-green-500'}
          textColor={isLight ? 'text-emerald-500' : 'text-green-400'}
          unavailable={macGpuPercent === undefined}
          unavailableLabel="Metal stats unavailable"
        />
        <Gauge
          label="CPU"
          bars={cpu ? [{ percent: cpu.percent, detail: `${cpu.percent}% across all cores` }] : []}
          barColor={isLight ? 'bg-amber-500' : 'bg-yellow-500'}
          textColor={isLight ? 'text-amber-500' : 'text-yellow-400'}
        />
        <Gauge
          label="Unified Memory"
          bars={ram ? [{ percent: ram.percent, detail: `${formatMb(ram.usedMb)} / ${formatMb(ram.totalMb)}` }] : []}
          barColor="bg-purple-500"
          textColor={isLight ? 'text-purple-500' : 'text-purple-400'}
        />
      </div>
    )
  }

  const gpuBars: GaugeBarData[] = gpus?.map((g) => ({
    percent: g.gpuPercent,
    label: g.name,
    detail: g.temperatureC !== undefined ? `${g.temperatureC}°C` : undefined,
    secondaryPercent: g.powerPercent,
    secondaryDetail: g.powerDrawW !== undefined && g.powerLimitW !== undefined ? `${g.powerDrawW}W/${g.powerLimitW}W` : undefined
  })) ?? []

  const vramBars: GaugeBarData[] = gpus?.map((g) => ({
    percent: Math.round((g.memUsedMb / g.memTotalMb) * 100),
    label: g.name,
    detail: `${formatMb(g.memUsedMb)} / ${formatMb(g.memTotalMb)}`
  })) ?? []

  return (
    <div className="grid grid-cols-4 gap-2 px-3 sm:px-4 py-3 bg-gradient-to-b from-zinc-900/30 to-transparent">
      <Gauge
        label="GPU"
        bars={gpuBars}
        barColor={isLight ? 'bg-emerald-500' : 'bg-green-500'}
        textColor={isLight ? 'text-emerald-500' : 'text-green-400'}
        unavailable={!gpus || gpus.length === 0}
      />
      <Gauge
        label="VRAM"
        bars={vramBars}
        barColor="bg-blue-500"
        textColor={isLight ? 'text-blue-500' : 'text-blue-400'}
        unavailable={!gpus || gpus.length === 0}
      />
      <Gauge
        label="CPU"
        bars={cpu ? [{ percent: cpu.percent, detail: `${cpu.percent}% across all cores` }] : []}
        barColor={isLight ? 'bg-amber-500' : 'bg-yellow-500'}
        textColor={isLight ? 'text-amber-500' : 'text-yellow-400'}
      />
      <Gauge
        label="RAM"
        bars={ram ? [{ percent: ram.percent, detail: `${formatMb(ram.usedMb)} / ${formatMb(ram.totalMb)}` }] : []}
        barColor="bg-purple-500"
        textColor={isLight ? 'text-purple-500' : 'text-purple-400'}
      />
    </div>
  )
}
