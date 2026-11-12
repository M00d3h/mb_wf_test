import { useEffect, useMemo, useState } from 'react'
import { Download, Trash2, Square } from 'lucide-react'
import { useModelsStore } from '../../store/modelsStore'
import { useSettingsStore } from '../../store/settingsStore'
import { useThemeStore } from '../../store/themeStore'
import { useHfDownloadStore } from '../../store/hfDownloadStore'
import { useServerStore } from '../../store/serverStore'
import { cn } from '../../lib/utils'
import { getHfProviderFolderSlugFromModel } from '../../lib/hfModelPublisher'
import { ProfileList } from './ProfileList'
import { LaunchModelProfileButton } from './LaunchModelProfileButton'
import { FolderQuantProviderInline } from './FolderQuantProviderInline'
import { ModelBrandAvatar } from '../chat/ModelBrandAvatar'
import { api } from '../../lib/ipc'
import type { HfIncompleteDownloadInfo, Model } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'

interface Props {
  model: Model
  onDownloadComplete?: () => void
}

export function ModelDetails({ model, onDownloadComplete }: Props): JSX.Element {
  const { fetchProfiles, deleteModel, profiles } = useModelsStore()
  const { settings } = useSettingsStore()
  const { theme } = useThemeStore()
  const { instances, stopServer } = useServerStore()
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [incompleteInfo, setIncompleteInfo] = useState<HfIncompleteDownloadInfo | null>(null)
  const [resuming, setResuming] = useState(false)
  const registerPendingDownload = useHfDownloadStore((s) => s.registerPendingDownload)
  const reportDownloadError = useHfDownloadStore((s) => s.reportDownloadError)

  const modelProfiles = profiles[model.id] ?? []
  const modelProfileIds = new Set(modelProfiles.map((p) => p.id))
  const runningInst = instances.find(
    (i) =>
      i.instanceKind === 'llama' &&
      i.profileId !== null &&
      modelProfileIds.has(i.profileId) &&
      (i.state === 'running' || i.state === 'starting' || i.state === 'loading'),
  )

  const folderProvider = useMemo(
    () => getHfProviderFolderSlugFromModel(model, settings?.modelsDirs ?? []),
    [model, settings?.modelsDirs],
  )

  const ggufSizeLabel = useMemo(() => {
    const b = model.ggufTotalBytes ?? 0
    if (b <= 0) return null
    return `${(b / 1e9).toFixed(2)} GB`
  }, [model.ggufTotalBytes])

  const modelRootDir = useMemo(() => {
    const dirs = settings?.modelsDirs ?? []
    const normalize = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '')
    const modelPath = normalize(model.modelDir)
    const match = dirs.find((d) => modelPath.startsWith(normalize(d)))
    return match ?? model.modelDir
  }, [model.modelDir, settings?.modelsDirs])

  useEffect(() => {
    fetchProfiles(model.id)
  }, [model.id, fetchProfiles])

  useEffect(() => {
    setIncompleteInfo(null)
    void api.hf.getIncompleteMeta(model.modelDir).then(setIncompleteInfo).catch(() => {})
  }, [model.modelDir])

  const handleResumeDownload = async (): Promise<void> => {
    if (!incompleteInfo || resuming) return
    const { meta } = incompleteInfo
    const downloadId = uuidv4()
    setResuming(true)
    registerPendingDownload(downloadId, "", meta.repoId)
    try {
      const result = await api.hf.download({
        downloadId,
        repoId: meta.repoId,
        filenames: meta.filenames,
        fileSizes: meta.fileSizes,
        modelsDir: meta.modelsDir,
        destFolder: meta.destFolder,
      })
      if (result.ok) {
        setIncompleteInfo(null)
        onDownloadComplete?.()
      } else if (!result.aborted) {
        reportDownloadError(result.error ?? 'Resume failed')
      }
    } catch (e: unknown) {
      reportDownloadError(e instanceof Error ? e.message : String(e))
    } finally {
      setResuming(false)
    }
  }

  const handleDeleteModel = async (): Promise<void> => {
    setDeleting(true)
    setConfirmDelete(false)
    try {
      await deleteModel(model.id)
    } catch (e) {
      console.error(e)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div
        className={cn(
          'px-5 py-4 bg-gradient-to-b to-transparent shrink-0',
          theme === 'light' ? 'from-zinc-950/50' : 'from-zinc-900/50',
        )}
      >
        <div className="flex items-start gap-3 min-w-0">
          <ModelBrandAvatar model={model} size="md" className="shrink-0 mt-0.5" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="min-w-0 flex flex-col gap-0.5">
              <div className="flex min-w-0 items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-0.5">
                  <h2 className="text-base font-semibold text-zinc-100 tracking-tight min-w-0 truncate">
                    {model.name}
                  </h2>
                  {ggufSizeLabel && (
                    <span
                      className={cn(
                        'text-xs font-normal shrink-0',
                        theme === 'light' ? 'text-zinc-500/90' : 'text-zinc-400/55',
                      )}
                    >
                      {ggufSizeLabel}
                    </span>
                  )}
                  <span
                    title={model.modelDir}
                    className={cn(
                      'text-xs font-normal truncate max-w-[14rem] cursor-default',
                      theme === 'light' ? 'text-zinc-500/70' : 'text-zinc-500/80',
                    )}
                  >
                    {modelRootDir}
                  </span>
                </div>
                {confirmDelete ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={cn('text-xs', theme === 'light' ? 'text-zinc-500' : 'text-zinc-400')}>
                      Delete?
                    </span>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => void handleDeleteModel()}
                      className={cn(
                        'rounded px-1.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50',
                        theme === 'light'
                          ? 'bg-red-100 text-red-700 hover:bg-red-200'
                          : 'bg-red-500/20 text-red-400 hover:bg-red-500/30',
                      )}
                    >
                      {deleting ? '…' : 'Yes'}
                    </button>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => setConfirmDelete(false)}
                      className={cn(
                        'rounded px-1.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50',
                        theme === 'light'
                          ? 'bg-zinc-300 text-zinc-700 hover:bg-zinc-400 hover:text-zinc-900'
                          : 'bg-zinc-700/60 text-zinc-400 hover:bg-zinc-700',
                      )}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    title="Delete model"
                    aria-label="Delete model"
                    onClick={() => setConfirmDelete(true)}
                    className={cn(
                      'shrink-0 rounded-lg p-1.5 transition-colors',
                      theme === 'light'
                        ? 'text-red-600 hover:bg-red-50 hover:text-red-700'
                        : 'text-red-400/90 hover:bg-red-950/35 hover:text-red-300',
                    )}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
              {folderProvider && (
                <div className="min-w-0">
                  <FolderQuantProviderInline providerSlug={folderProvider} />
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <LaunchModelProfileButton
                modelId={model.id}
                onErrorChange={setLaunchError}
              />
              {runningInst && (
                <button
                  title="Stop"
                  onClick={() => stopServer(runningInst.id)}
                  className="p-1 text-red-400 hover:bg-red-500/10 rounded"
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {launchError && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-2 py-1.5">
                {launchError}
              </div>
            )}
          </div>
        </div>
      </div>

      {incompleteInfo && (
        <div className="mx-4 mb-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className={cn(
              "text-xs font-medium",
              theme === "light" ? "text-amber-700/80" : "text-amber-300",
            )}>
              Download incomplete —{" "}
              {incompleteInfo.missingFilenames.length === 1
                ? "1 file missing"
                : `${incompleteInfo.missingFilenames.length} files missing`}
            </p>
            <button
              type="button"
              disabled={resuming}
              onClick={() => void handleResumeDownload()}
              className={cn(
                "shrink-0 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                theme === "light"
                  ? "bg-amber-500/20 text-amber-700 hover:bg-amber-500/30"
                  : "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30",
              )}
            >
              <Download className="h-3 w-3" aria-hidden />
              {resuming ? "Resuming…" : "Resume download"}
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-2">
        <ProfileList modelId={model.id} />
      </div>
    </div>
  )
}
