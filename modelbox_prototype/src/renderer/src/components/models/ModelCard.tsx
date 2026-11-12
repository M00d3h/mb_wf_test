import { useMemo } from 'react'
import { TagChip } from '../shared/TagChip'
import { StatusBadge } from '../shared/StatusBadge'
import { ModelBrandAvatar } from '../chat/ModelBrandAvatar'
import { FolderQuantProviderInline } from './FolderQuantProviderInline'
import { extractQuant, cn } from '../../lib/utils'
import { getHfProviderFolderSlugFromModel } from '../../lib/hfModelPublisher'
import { useSettingsStore } from '../../store/settingsStore'
import { useServerStore } from '../../store/serverStore'
import { useThemeStore } from '../../store/themeStore'
import type { Model } from '@shared/types'

interface Props {
  model: Model
  /** When set, overrides `model.isMultimodal` for the MM tag (e.g. profile-only mmproj path). */
  visionCapable?: boolean
  selected: boolean
  onClick: () => void
  incomplete?: boolean
}

export function ModelCard({ model, visionCapable, selected, onClick, incomplete }: Props): JSX.Element {
  const showMultimodalTag = visionCapable ?? model.isMultimodal
  const { instances } = useServerStore()
  const { settings } = useSettingsStore()
  const { theme } = useThemeStore()
  const runningInst = instances.find(
    (i) =>
      i.modelId === model.id &&
      (i.state === 'running' ||
        i.state === 'loading' ||
        i.state === 'starting' ||
        i.state.startsWith('vllm-'))
  )

  const folderProvider = useMemo(
    () => getHfProviderFolderSlugFromModel(model, settings?.modelsDirs ?? []),
    [model, settings?.modelsDirs],
  )

  const quant =
    model.quantLabel ??
    extractQuant(model.name) ??
    extractQuant(model.ggufPath.split(/[\\/]/).pop() ?? '')

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left flex items-start gap-2 px-2.5 py-2 rounded-md border transition-colors',
        selected
          ? 'bg-cyan-500/15 border-cyan-500/40 text-zinc-100'
          : theme === 'light'
            ? 'border border-zinc-700/20 bg-zinc-800/40 text-zinc-300 hover:border-zinc-600/45 hover:bg-zinc-800/65'
            : 'border border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-600'
      )}
    >
      <ModelBrandAvatar
        model={model}
        size="sm"
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-tight truncate">{model.name}</div>
        <div className="flex flex-wrap gap-1 mt-1">
          {model.name.toUpperCase().includes('MOE') && (
            <TagChip label="MOE" variant="moe" />
          )}
          {model.isEmbedding && <TagChip label="Embed" variant="embed" />}
          {showMultimodalTag && <TagChip label="MM" variant="mm" />}
          {quant && <TagChip label={quant} variant="quant" />}
          {folderProvider && (
            <FolderQuantProviderInline providerSlug={folderProvider} />
          )}
          {incomplete && <TagChip label="Incomplete" variant="incomplete" />}
        </div>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1 pt-0.5">
        {runningInst && (
          <>
            <StatusBadge state={runningInst.state} className="text-[10px]" />
            <span className="text-[10px] text-green-400 font-mono">:{runningInst.port}</span>
          </>
        )}
      </div>
    </button>
  )
}
