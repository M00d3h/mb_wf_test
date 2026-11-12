import { useEffect, useRef } from "react";
import { Play } from "lucide-react";
import { cn } from "../../lib/utils";
import { useModelsStore } from "../../store/modelsStore";
import { useServerStore } from "../../store/serverStore";
import { useThemeStore } from "../../store/themeStore";
import { serverStateBadgeConfig } from "../shared/StatusBadge";

interface Props {
  modelId: string;
  /** Shown below the header row in the parent when launch fails */
  onErrorChange?: (message: string | null) => void;
}

export function LaunchModelProfileButton({
  modelId,
  onErrorChange,
}: Props): JSX.Element | null {
  const { profiles } = useModelsStore();
  const { startServer, instances, clearInstance, trackLaunchedInstance } = useServerStore();
  const modelProfiles = profiles[modelId] ?? [];
  const activeProfile = modelProfiles.find((p) => p.active);
  const instance = instances.find(
    (inst) => inst.profileId === activeProfile?.id,
  );
  const state = instance?.state;
  const isStarting = state === "starting" || state === "loading";
  const isRunning = state === "running";
  const isError = state === "error";
  const showInstanceBadge =
    state === "starting" || state === "loading" || state === "running";
  const badgeCfg =
    state && serverStateBadgeConfig[state]
      ? serverStateBadgeConfig[state]
      : serverStateBadgeConfig.unknown;
  const { theme } = useThemeStore();
  const isLight = theme === "light";
  const launchingRef = useRef(false);
  
  useEffect(() => {
    onErrorChange?.(null);
  }, [modelId, onErrorChange]);

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
          inst.instanceKind === "llama" &&
          inst.profileId === active.id &&
          inst.state === "error",
      );
      await Promise.all(errored.map((inst) => clearInstance(inst.id)));
      const result = await startServer(active.id);
      trackLaunchedInstance(result.instance.id);
    } catch (e: unknown) {
      const err = e as Error & { code?: string; suggestedPort?: number };
      if (err.code === "PORT_BUSY") {
        onErrorChange?.(`Port busy! Suggested port: ${err.suggestedPort}`);
      } else {
        onErrorChange?.(err.message);
      }
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
          disabled={launchingRef.current}
          className={cn(
            "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
            "focus:outline-none focus:ring-1 focus:ring-cyan-500/35",
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

  const statusLabel =
    state === "loading"
      ? "Loading..."
      : state === "starting"
        ? "Starting"
        : state === "running"
          ? "Running"
          : "Launch Model";

  return (
    <button
      type="button"
      onClick={() => void handleStartActive()}
      disabled={isStarting || isRunning}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1.5 border text-xs font-medium transition-colors",
        "focus:outline-none focus:ring-1 focus:ring-cyan-500/35",
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
  );
}
