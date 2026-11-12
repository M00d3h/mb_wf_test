import { X, Clock } from 'lucide-react'
import { useServerStore } from '../../store/serverStore'

export function QueuePanel(): JSX.Element {
  const { queue, cancelQueued } = useServerStore()

  if (queue.length === 0) return <></>

  return (
    <div className="mx-3 mb-3 mt-1 rounded-xl border border-amber-500/10 bg-amber-500/[0.04] px-3 py-2.5">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-3.5 h-3.5 text-yellow-400" />
        <span className="text-xs font-medium text-yellow-400">
          Queue ({queue.length})
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {queue.map((entry) => (
          <div
            key={entry.id}
            className="flex items-center justify-between px-2 py-1.5 bg-zinc-800/50 border border-zinc-700 rounded text-xs"
          >
            <div className="flex items-center gap-2">
              <span className="text-zinc-300">{entry.modelName}</span>
              <span className="text-zinc-500">•</span>
              <span className="text-zinc-400">{entry.profileName}</span>
              <span className="text-zinc-500 font-mono">:{entry.port}</span>
            </div>
            <button
              onClick={() => cancelQueued(entry.id)}
              className="text-zinc-500 hover:text-red-400"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
