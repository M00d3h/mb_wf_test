import { useEffect, useRef } from "react";
import { Play } from "lucide-react";
import { cn } from "../../lib/utils";
import { useVllmStore } from "../../store/vllmStore";
import { useServerStore } from "../../store/serverStore";
import { useThemeStore } from "../../store/themeStore";
import { useVllmSetupStore } from "../../store/vllmSetupStore";
import { useSettingsStore } from "../../store/settingsStore";
import { isVllmConfigured } from "../../lib/runtimeUtils";
import { serverStateBadgeConfig } from "../shared/StatusBadge";
import { api } from "../../lib/ipc";
import vllmColorIcon from "../../assets/vllm-color.svg";

interface Props {
  vllmModelId: string;
  onErrorChange?: (message: string | null) => void;
}

export function LaunchVllmProfileButton({
  vllmModelId,
  onErrorChange,
}: Props): JSX.Element | null {
  const { profiles } = useVllmStore();
  const { fetchInstances, instances, clearInstance, trackLaunchedInstance } = useServerStore();
  const modelProfiles = profiles[vllmModelId] ?? [];
  const activeProfile = modelProfiles.find((p) => p.active);
  const instance = instances.find(
    (inst) =>
      inst.instanceKind === "vllm" &&
      inst.vllmProfileId === activeProfile?.id,
  );
  const state = instance?.state;
  const isStarting = state === "starting" || state === "loading" || (state != null && state.startsWith("vllm-"));
  const isRunning = state === "running";
  const isError = state === "error";
  const showInstanceBadge =
    state === "starting" || state === "loading" || state === "running" || (state != null && state.startsWith("vllm-"));
  const badgeCfg =
    state && serverStateBadgeConfig[state]
      ? serverStateBadgeConfig[state]
      : serverStateBadgeConfig.unknown;
  const { theme } = useThemeStore();
  const isLight = theme === "light";
  const launchingRef = useRef(false);
  const { runtimeInfo } = useVllmSetupStore();
  const { settings } = useSettingsStore();
  const vllmInstalled = isVllmConfigured(settings, runtimeInfo);
 
  useEffect(() => {
    onErrorChange?.(null);
  }, [vllmModelId, onErrorChange]);

  const handleStartActive = async (): Promise<void> => {
    if (launchingRef.current) return;
    const active = modelProfiles.find((p) => p.active);
    if (!active) return;
    launchingRef.current = true;
    onErrorChange?.(null);
    try {
      // Clear errored instances for this profile before relaunching
      const errored = instances.filter(
        (inst) =>
          inst.instanceKind === "vllm" &&
          inst.vllmProfileId === active.id &&
          inst.state === "error",
      );
      await Promise.all(errored.map((inst) => clearInstance(inst.id)));
      const inst = await api.vllm.start(active.id);
      trackLaunchedInstance(inst.id);
      await fetchInstances();
    } catch (e: unknown) {
      onErrorChange?.(e instanceof Error ? e.message : String(e));
    } finally {
      launchingRef.current = false;
    }
  };

  if (!modelProfiles.some((p) => p.active)) return null;

  // Error state: relaunch button on left, error chip on right
  if (isError) {
    const errorCfg = serverStateBadgeConfig.error;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleStartActive()}
          disabled={launchingRef.current || !vllmInstalled}
          className={cn(
            "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
            "focus:outline-none focus:ring-1 focus:ring-cyan-500/35",
            !vllmInstalled && "opacity-40 cursor-not-allowed",
            isLight
              ? "shadow-none ring-1 ring-inset ring-zinc-700/25"
              : "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]",
            isLight
              ? "border-cyan-300 bg-cyan-50 text-cyan-900 hover:border-cyan-400 hover:bg-cyan-100 active:translate-y-[0.5px]"
              : "border-cyan-500/25 bg-cyan-950/35 text-cyan-100/95 hover:border-cyan-500/45 hover:bg-cyan-500/10 active:translate-y-[0.5px]",
          )}
        >
          <Play
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              isLight ? "text-cyan-700" : "text-cyan-400/85",
            )}
          />
          Relaunch Model
        </button>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
            isLight ? errorCfg.light : errorCfg.dark,
          )}
        >
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", errorCfg.dot)} />
          {errorCfg.label}
        </span>
      </div>
    );
  }

  const statusLabel = state ? (serverStateBadgeConfig[state]?.label ?? "Launch Model") : "Launch Model";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void handleStartActive()}
        disabled={isStarting || isRunning || !vllmInstalled}
        className={cn(
          "inline-flex shrink-0 items-center justify-center gap-1.5 border text-xs font-medium transition-colors",
          "focus:outline-none focus:ring-1 focus:ring-cyan-500/35",
          !vllmInstalled && "opacity-40 cursor-not-allowed",
          showInstanceBadge
            ? cn(
                "rounded-full px-2.5 py-1",
                isLight ? badgeCfg.light : badgeCfg.dark,
                isStarting && "disabled:cursor-wait",
                isRunning && "disabled:cursor-default",
              )
            : cn(
                "rounded-lg px-3 py-1.5 gap-2",
                isLight
                  ? "shadow-none ring-1 ring-inset ring-zinc-700/25"
                  : "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]",
                isLight
                  ? "border-cyan-300 bg-cyan-50 text-cyan-900 hover:border-cyan-400 hover:bg-cyan-100 active:translate-y-[0.5px]"
                  : "border-cyan-500/25 bg-cyan-950/35 text-cyan-100/95 hover:border-cyan-500/45 hover:bg-cyan-500/10 active:translate-y-[0.5px]",
              ),
        )}
      >
        {showInstanceBadge ? (
          <>
            <span
              className={cn("h-1.5 w-1.5 shrink-0 rounded-full", badgeCfg.dot)}
              aria-hidden
            />
            {statusLabel}
          </>
        ) : (
          <>
            <Play
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                isLight ? "text-cyan-700" : "text-cyan-400/85",
              )}
            />
            {statusLabel}
          </>
        )}
      </button>
      {!vllmInstalled && (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
            isLight
              ? "border-zinc-600/30 bg-zinc-800/60 text-zinc-400"
              : "border-zinc-700/50 bg-zinc-800/50 text-zinc-500",
          )}
        >
          <img src={vllmColorIcon} alt="" className="h-3 w-3 shrink-0 opacity-60" />
          vLLM not installed
        </span>
      )}
    </div>
  );
}
