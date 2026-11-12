import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ArrowRight, RefreshCw } from 'lucide-react'
import { useSettingsStore } from '../store/settingsStore'
import { useModelsStore } from '../store/modelsStore'
import { useVllmSetupStore } from '../store/vllmSetupStore'
import { api } from '../lib/ipc'
import { ModelsDirsEditor } from '../components/settings/ModelsDirsEditor'
import type { LlamaRuntimeInfo, VllmRuntimeInfo, RuntimeProgressEvent } from '@shared/types'
import modelboxIcon from '../assets/modelbox-icon.png'
import llamacppIcon from '../assets/llamacpp-icon.png'
import vllmColorIcon from '../assets/vllm-color.svg'

const isMacOs = window.platform === 'darwin'
// vLLM auto-install disabled in the setup wizard for v1.x — users configure it manually in Settings.
const showVllmInWizard = false

type Step = 1 | 2

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FirstRunPage(): JSX.Element {
  const navigate = useNavigate()
  const { settings, update, fetch: fetchSettings } = useSettingsStore()
  const { scanModels } = useModelsStore()
  const vllmSetup = useVllmSetupStore()

  const [step, setStep] = useState<Step>(1)
  const [modelsDirs, setModelsDirs] = useState<string[]>([])

  // Step 1 state
  const [llamaInfo, setLlamaInfo] = useState<LlamaRuntimeInfo | null>(null)
  const [vllmInfo, setVllmInfo] = useState<VllmRuntimeInfo | null>(null)
  const [llamaSelected, setLlamaSelected] = useState(true)
  const [vllmSelected, setVllmSelected] = useState(showVllmInWizard && !isMacOs)
  const [installing, setInstalling] = useState(false)
  const [installPhase, setInstallPhase] = useState<string>('')
  const [downloadProgress, setDownloadProgress] = useState<{ received: number; total?: number } | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)

  useEffect(() => {
    void api.runtime.getStatus().then((s) => {
      setLlamaInfo(s.llama)
      setVllmInfo(s.vllm)
    })
  }, [])

  useEffect(() => {
    if (settings?.modelsDirs?.length) {
      setModelsDirs(settings.modelsDirs)
    }
  }, [settings])

  // Subscribe to llama runtime:progress events
  useEffect(() => {
    const unsub = api.on('runtime:progress', (...args: unknown[]) => {
      const event = args[1] as RuntimeProgressEvent
      if (event.kind !== 'llama') return
      if (event.phase === 'download') {
        setInstallPhase('download')
        setDownloadProgress({ received: event.receivedBytes, total: event.totalBytes })
      } else if (event.phase === 'extract') {
        setInstallPhase('extract')
      } else if (event.phase === 'gpu-detect') {
        setInstallPhase('detect')
      } else if (event.phase === 'fetch-release') {
        setInstallPhase('fetch')
      } else if (event.phase === 'complete') {
        setLlamaInfo(event.info)
        setInstallPhase('complete')
      } else if (event.phase === 'error') {
        setInstallError(event.error)
        setInstallPhase('')
      }
    })
    return () => unsub()
  }, [])

  const handleContinue = async (): Promise<void> => {
    // Start vLLM setup in background (fire-and-forget)
    if (vllmSelected && vllmInfo?.status !== 'installed' && vllmSetup.phase === 'idle') {
      void vllmSetup.startSetup()
    }

    // Install llama.cpp synchronously (wizard waits)
    if (llamaSelected && llamaInfo?.status !== 'installed') {
      setInstalling(true)
      setInstallError(null)
      setInstallPhase('detect')
      setDownloadProgress(null)
      try {
        const info = await api.runtime.installLlama()
        setLlamaInfo(info)
        if (info.status !== 'installed') {
          setInstallError(info.error ?? 'Installation failed')
          setInstalling(false)
          return
        }
        await fetchSettings()
      } catch (e: unknown) {
        setInstallError(e instanceof Error ? e.message : 'Installation failed')
        setInstalling(false)
        return
      }
      setInstalling(false)
    }

    setStep(2)
  }

  const handleFinish = async (): Promise<void> => {
    await update({ modelsDirs, firstRun: false })
    // Scan models in the background so the list is ready on the Models page
    void scanModels()
    navigate('/models')
  }

  const isLlamaInstalled = llamaInfo?.status === 'installed'
  const isVllmInstalled = vllmInfo?.status === 'installed'

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-950">
      <div className="w-full max-w-lg px-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <img src={modelboxIcon} className="w-10 h-10 rounded-xl object-contain" alt="ModelBox" />
          <div>
            <h1 className="text-xl font-bold text-zinc-100">Welcome to ModelBox</h1>
            <p className="text-xs text-zinc-500">First-run setup</p>
          </div>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2 mb-6">
          {([1, 2] as const).map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  step > s
                    ? 'bg-green-500 text-white'
                    : step === s
                    ? 'bg-cyan-500 text-white'
                    : 'bg-zinc-700 text-zinc-500'
                }`}
              >
                {step > s ? <Check className="w-3.5 h-3.5" /> : s}
              </div>
              {s < 2 && (
                <div className={`h-px w-8 ${step > s ? 'bg-green-500/50' : 'bg-zinc-700'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Choose components */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-200">Choose components</h2>
              <p className="text-sm text-zinc-400 mt-1">Select what to install. You can change this later in Settings.</p>
            </div>

            <div className="flex flex-col gap-3">
              {/* llama.cpp card */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => !installing && setLlamaSelected((s) => !s)}
                onKeyDown={(e) => e.key === 'Enter' && !installing && setLlamaSelected((s) => !s)}
                className={`relative rounded-xl border-2 p-4 cursor-pointer transition-colors select-none ${
                  llamaSelected
                    ? 'border-cyan-500/60 bg-cyan-500/[0.06]'
                    : 'border-zinc-700/60 bg-zinc-900/20'
                } ${installing ? 'cursor-default opacity-80' : ''}`}
              >
                <div className="flex items-center gap-3">
                  {/* Checkbox */}
                  <div
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                      llamaSelected ? 'border-cyan-500 bg-cyan-500' : 'border-zinc-600 bg-transparent'
                    }`}
                  >
                    {llamaSelected && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <img src={llamacppIcon} className="w-8 h-8 shrink-0" alt="" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-zinc-100 text-sm">llama.cpp</p>
                    <p className="text-xs text-zinc-400 mt-0.5">Run GGUF models locally with GPU acceleration</p>
                  </div>
                  {isLlamaInstalled && (
                    <span className="shrink-0 text-xs text-green-400 font-medium bg-green-500/10 px-2 py-0.5 rounded-full">
                      Installed
                    </span>
                  )}
                </div>

                {/* Inline progress for llama install */}
                {installing && (
                  <div className="mt-3 flex flex-col gap-2 rounded-lg bg-zinc-800/60 border border-zinc-700/50 px-3 py-2.5">
                    {(installPhase === 'detect' || installPhase === 'fetch') && (
                      <div className="flex items-center gap-2 text-sm text-zinc-300">
                        <RefreshCw className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
                        {installPhase === 'detect' ? 'Detecting GPU…' : 'Fetching latest release…'}
                      </div>
                    )}
                    {installPhase === 'download' && downloadProgress && (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between text-xs text-zinc-400">
                          <span>Downloading…</span>
                          <span>
                            {formatBytes(downloadProgress.received)}
                            {downloadProgress.total ? ` / ${formatBytes(downloadProgress.total)}` : ''}
                          </span>
                        </div>
                        {downloadProgress.total && (
                          <div className="h-1.5 rounded-full bg-zinc-700 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-cyan-500 transition-all duration-150"
                              style={{
                                width: `${Math.min(100, (downloadProgress.received / downloadProgress.total) * 100).toFixed(1)}%`,
                              }}
                            />
                          </div>
                        )}
                      </div>
                    )}
                    {installPhase === 'extract' && (
                      <div className="flex items-center gap-2 text-sm text-zinc-300">
                        <RefreshCw className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
                        Extracting…
                      </div>
                    )}
                    {installPhase === 'complete' && (
                      <div className="flex items-center gap-2 text-sm text-green-300">
                        <Check className="w-4 h-4 text-green-400 shrink-0" />
                        Done!
                      </div>
                    )}
                  </div>
                )}

                {/* Error */}
                {installError && !installing && (
                  <div className="mt-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-300">
                    {installError}
                  </div>
                )}
              </div>

              {/* vLLM card (hidden on macOS and disabled in wizard for v1.x) */}
              {showVllmInWizard && !isMacOs && (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => !installing && setVllmSelected((s) => !s)}
                  onKeyDown={(e) => e.key === 'Enter' && !installing && setVllmSelected((s) => !s)}
                  className={`rounded-xl border-2 p-4 cursor-pointer transition-colors select-none ${
                    vllmSelected
                      ? 'border-cyan-500/60 bg-cyan-500/[0.06]'
                      : 'border-zinc-700/60 bg-zinc-900/20'
                  } ${installing ? 'cursor-default opacity-80' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                        vllmSelected ? 'border-cyan-500 bg-cyan-500' : 'border-zinc-600 bg-transparent'
                      }`}
                    >
                      {vllmSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <img src={vllmColorIcon} className="w-8 h-8 shrink-0" alt="" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-zinc-100 text-sm">vLLM</p>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        High-performance inference for Transformers models
                        {window.platform === 'win32' ? ' (requires WSL)' : ''}
                      </p>
                    </div>
                    {isVllmInstalled && (
                      <span className="shrink-0 text-xs text-green-400 font-medium bg-green-500/10 px-2 py-0.5 rounded-full">
                        Installed
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 mt-1">
              <button
                onClick={() => void handleContinue()}
                disabled={installing}
                className="flex items-center justify-center gap-2 flex-1 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white font-medium rounded-lg transition-colors"
              >
                {installing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Installing…
                  </>
                ) : (
                  <>
                    Continue <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
              {!installing && (
                <button
                  onClick={() => setStep(2)}
                  className="px-4 py-2.5 text-zinc-400 hover:text-zinc-200 text-sm rounded-lg border border-zinc-700 hover:border-zinc-600 transition-colors"
                >
                  Skip
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Model directories */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <h2 className="text-base font-semibold text-zinc-200">Model directories</h2>
            <p className="text-sm text-zinc-400">
              Where are your GGUF model files stored? The default folder is ready to use.
            </p>
            <ModelsDirsEditor
              value={modelsDirs}
              onCommit={(dirs) => setModelsDirs(dirs)}
            />
            <button
              onClick={() => void handleFinish()}
              className="mt-1 flex items-center justify-center gap-2 py-2.5 bg-green-600 hover:bg-green-500 text-white font-medium rounded-lg transition-colors"
            >
              Get Started <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
