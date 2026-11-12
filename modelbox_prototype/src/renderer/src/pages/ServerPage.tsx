import { useState, useEffect } from 'react'
import { InstancesTable } from '../components/server/InstancesTable'
import { LogsViewer } from '../components/server/LogsViewer'
import { QueuePanel } from '../components/server/QueuePanel'
import { SystemStatsPanel } from '../components/server/SystemStats'
import { useServerStore } from '../store/serverStore'

export function ServerPage(): JSX.Element {
  const { instances, lastLaunchedInstanceId } = useServerStore()
  const [selectedId, setSelectedId] = useState<string | null>(
    instances[0]?.id ?? null
  )

  // Auto-select the newly launched instance when the old selection is gone
  useEffect(() => {
    if (!selectedId) return
    const exists = instances.some((i) => i.id === selectedId)
    if (exists) return
    // Selection is stale — pick the newly launched instance or first one
    const fallback = lastLaunchedInstanceId && instances.some((i) => i.id === lastLaunchedInstanceId)
      ? lastLaunchedInstanceId
      : instances[0]?.id ?? null
    setSelectedId(fallback)
  }, [instances, selectedId, lastLaunchedInstanceId])

  return (
    <div className="flex flex-col h-full min-h-0 gap-3 p-3">
      {/* Instances + queue */}
      <div className="flex-[0_0_40%] flex flex-col min-h-0 rounded-2xl bg-zinc-900/35 ring-1 ring-white/[0.06] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] overflow-hidden">
        <div className="px-4 pt-3.5 pb-2 shrink-0">
          <h2 className="text-sm font-semibold text-zinc-100 tracking-tight">
            Server instances
          </h2>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            Running vLLM and llama-server processes
          </p>
        </div>
        <div className="flex-1 min-h-0 overflow-auto">
          <InstancesTable
            onSelectInstance={setSelectedId}
            selectedId={selectedId}
          />
        </div>
        <QueuePanel />
      </div>

      {/* Stats + logs */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0 rounded-2xl bg-zinc-900/25 ring-1 ring-white/[0.05]">
        <SystemStatsPanel />

        <div className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-2">
          <span className="text-xs font-semibold tracking-tight text-zinc-300">
            Console
          </span>
          {selectedId && (
            <span className="font-mono text-[10px] tabular-nums text-zinc-500">
              {selectedId.slice(0, 8)}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3">
          {selectedId ? (
            <div className="h-full min-h-0 overflow-hidden">
              <LogsViewer instanceId={selectedId} />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl bg-zinc-950/30 text-sm text-zinc-600">
              Select an instance to view console output
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
