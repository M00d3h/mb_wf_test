import { useState, useEffect, useRef, useLayoutEffect } from "react";
import {
  Copy,
  Eye,
  EyeOff,
  Terminal,
  Check,
  AlertCircle,
  CircleCheck,
  Loader2,
  X,
} from "lucide-react";
import { api } from "../../lib/ipc";
import { useModelsStore } from "../../store/modelsStore";
import { API_KEY_COMMAND_MASK } from "@shared/apiKeyMask";
import type { BuildCommandResult, Profile, ProfileConfig } from "@shared/types";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/themeStore";

interface Props {
  profile: Profile;
  liveConfig?: ProfileConfig;
  liveApiKey?: string;
}

/** Same frame + typography as the preview button + inner `<pre>`; edit mode only changes background. */
const COMMAND_BOX_FRAME_DARK =
  "w-full rounded-lg border border-zinc-700/60 px-3 py-3 ring-1 ring-inset ring-white/[0.04] transition-colors";
const COMMAND_BOX_FRAME_LIGHT =
  "w-full rounded-lg border border-zinc-600/45 px-3 py-3 ring-1 ring-inset ring-zinc-700/25 transition-colors";
const COMMAND_TEXT_DARK =
  "font-mono text-sm leading-6 text-zinc-300 whitespace-pre-wrap break-all";
const COMMAND_TEXT_LIGHT =
  "font-mono text-sm leading-6 text-black whitespace-pre-wrap break-all";

export function LaunchCommandPanel({ profile, liveConfig, liveApiKey }: Props): JSX.Element {
  const { theme } = useThemeStore();
  const applyCustomCommandLineStore = useModelsStore(
    (s) => s.applyCustomCommandLine,
  );
  const [editingCommand, setEditingCommand] = useState(false);
  const [customLine, setCustomLine] = useState(
    profile.config.customCommandLine ?? "",
  );
  const [builderResult, setBuilderResult] = useState<BuildCommandResult | null>(
    null,
  );
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [loadingEditLine, setLoadingEditLine] = useState(false);
  const commandTextareaRef = useRef<HTMLTextAreaElement>(null);

  const refreshKey = profile.updatedAt;

  useLayoutEffect(() => {
    if (!editingCommand) return;
    const el = commandTextareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [editingCommand, customLine]);

  useEffect(() => {
    if (!showKey || editingCommand) {
      setResolvedKey(null);
      return;
    }
    let cancelled = false;
    api.profiles.getApiKey(profile.id).then((k) => {
      if (!cancelled) setResolvedKey(k);
    });
    return () => {
      cancelled = true;
    };
  }, [showKey, editingCommand, profile.id]);

  useEffect(() => {
    setCustomLine(profile.config.customCommandLine ?? "");
    setParseError(null);
  }, [profile.id, refreshKey, profile.config.customCommandLine]);

  useEffect(() => {
    let cancelled = false;
    // When live overrides are present, debounce slightly to avoid flooding IPC on rapid keystrokes.
    const hasLive = liveConfig !== undefined || liveApiKey !== undefined;
    const delay = hasLive ? 120 : 0;
    const run = (): void => {
      setBuilderError(null);
      const opts = hasLive
        ? { configOverride: liveConfig, apiKeyOverride: liveApiKey ?? null }
        : undefined;
      api.profiles
        .buildCommand(profile.id, opts)
        .then((r) => {
          if (!cancelled) setBuilderResult(r);
        })
        .catch((e) => {
          if (!cancelled) setBuilderError(String(e));
        });
    };
    if (delay > 0) {
      const t = setTimeout(run, delay);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    setBuilderResult(null);
    run();
    return () => {
      cancelled = true;
    };
  }, [profile.id, refreshKey, liveConfig, liveApiKey]);

  const unmask = (s: string, k: string | null | undefined): string => {
    if (k === undefined || k === null) return s;
    return s.split(API_KEY_COMMAND_MASK).join(k);
  };

  const displayRedactKey = (s: string): string =>
    s.split(API_KEY_COMMAND_MASK).join("•".repeat(8));

  const shownPreviewCommand =
    builderResult &&
    (showKey && resolvedKey
      ? unmask(builderResult.fullCommand, resolvedKey)
      : displayRedactKey(builderResult.fullCommand));

  const copyPreview = async (): Promise<void> => {
    if (!builderResult) return;
    let text = builderResult.fullCommand;
    if (showKey) {
      const k = resolvedKey ?? (await api.profiles.getApiKey(profile.id));
      text = unmask(text, k);
    } else {
      text = displayRedactKey(text);
    }
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };


  const startEditingCommand = async (): Promise<void> => {
    if (editingCommand || loadingEditLine) return;
    setParseError(null);
    setLoadingEditLine(true);
    try {
      const k = liveApiKey ?? (await api.profiles.getApiKey(profile.id));
      if (profile.config.customCommandLine) {
        setCustomLine(unmask(profile.config.customCommandLine, k ?? undefined));
      } else {
        // Build fresh with the current live config so the textarea always reflects
        // slider/select values even if the cached preview hasn't caught up yet.
        const r = await api.profiles.buildCommand(
          profile.id,
          liveConfig !== undefined
            ? { configOverride: liveConfig, apiKeyOverride: k ?? null }
            : { apiKeyOverride: k ?? null },
        );
        setCustomLine(unmask(r.fullCommand, k ?? undefined));
      }
      setEditingCommand(true);
    } catch (e) {
      setParseError(String(e));
    } finally {
      setLoadingEditLine(false);
    }
  };

  const cancelEditingCommand = (): void => {
    setEditingCommand(false);
    setParseError(null);
    setCustomLine(profile.config.customCommandLine ?? "");
  };

  const applyCustomLine = async (): Promise<void> => {
    const line = customLine.trim();
    if (!line) {
      setParseError("Command line is empty");
      return;
    }
    setApplying(true);
    setParseError(null);
    try {
      await applyCustomCommandLineStore(profile.id, line);
      setEditingCommand(false);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      className={cn(
        "shrink-0 rounded-xl overflow-hidden",
        theme === "light"
          ? "border border-zinc-700/35 bg-zinc-950/55 shadow-none ring-1 ring-zinc-700/20"
          : "border border-zinc-800/60 bg-zinc-900/50 ring-1 ring-white/[0.04]",
      )}
    >
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 px-3 py-2.5",
          theme === "light" ? "bg-zinc-950/45" : "bg-zinc-900/40",
        )}
      >
        <div className="flex items-center gap-2 text-sm text-zinc-400 min-w-0">
          <Terminal className="w-4 h-4 shrink-0" />
          <span className="font-medium text-zinc-300">Launch command</span>
        </div>
        <div className="flex-1" />
        {!editingCommand && builderResult && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowKey(!showKey)}
              className="p-1 text-zinc-500 hover:text-zinc-300 rounded"
              title={showKey ? "Mask API key in preview" : "Show API key"}
            >
              {showKey ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={copyPreview}
              className="p-1 text-zinc-500 hover:text-zinc-300 rounded"
              title="Copy command"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-green-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        )}
      </div>

      {!editingCommand && builderError && (
        <div className="px-3 py-2 text-sm text-red-400 flex items-start gap-2">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {builderError}
        </div>
      )}

      {builderResult && (
        <>
          {Object.keys(builderResult.envDisplay).length > 0 && (
            <div
              className={cn(
                "mx-3 mb-2 rounded-lg px-3 py-2.5",
                theme === "light"
                  ? "border border-zinc-700/30 bg-zinc-950/40"
                  : "bg-zinc-950/50 ring-1 ring-white/[0.04]",
              )}
            >
              <p
                className={cn(
                  "text-xs font-medium mb-1.5",
                  theme === "light" ? "text-zinc-600" : "text-zinc-500",
                )}
              >
                Environment
              </p>
              {Object.entries(builderResult.envDisplay).map(([k, v]) => (
                <div
                  key={k}
                  className={cn(
                    "font-mono text-sm leading-6",
                    theme === "light" ? "text-zinc-700" : "text-zinc-400",
                  )}
                >
                  <span
                    className={
                      theme === "light" ? "text-teal-800" : "text-teal-400"
                    }
                  >
                    {k}
                  </span>
                  =
                  <span
                    className={
                      theme === "light" ? "text-orange-800" : "text-orange-300"
                    }
                  >
                    {v}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="px-3 pb-3 flex flex-col gap-2.5">
            {editingCommand ? (
              <>
                <textarea
                  ref={commandTextareaRef}
                  value={customLine}
                  onChange={(e) => {
                    setCustomLine(e.target.value);
                    setParseError(null);
                  }}
                  spellCheck={false}
                  rows={1}
                  placeholder='"C:\\path\\llama-server.exe" -m model.gguf --port 8080'
                  className={cn(
                    theme === "light"
                      ? COMMAND_BOX_FRAME_LIGHT
                      : COMMAND_BOX_FRAME_DARK,
                    theme === "light"
                      ? "bg-cyan-50 text-left resize-none overflow-hidden border-cyan-300/80 ring-cyan-500/15"
                      : "bg-cyan-950/35 text-left resize-none overflow-hidden",
                    theme === "light" ? COMMAND_TEXT_LIGHT : COMMAND_TEXT_DARK,
                    "placeholder:text-zinc-500",
                    "focus:outline-none focus:ring-2",
                    theme === "light"
                      ? "focus:ring-cyan-500/35"
                      : "focus:ring-cyan-500/30",
                  )}
                />
                {parseError && (
                  <div className="text-sm text-red-400 flex items-start gap-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {parseError}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
                  <button
                    type="button"
                    onClick={applyCustomLine}
                    disabled={applying}
                    className={cn(
                      "inline-flex items-center justify-center gap-1.5 rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors",
                      "focus:outline-none focus:ring-1 focus:ring-cyan-500/35",
                      theme === "light"
                        ? "shadow-none ring-1 ring-inset ring-zinc-700/25 border-cyan-300 bg-cyan-50 text-cyan-900 hover:border-cyan-400 hover:bg-cyan-100 active:translate-y-[0.5px]"
                        : "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] border-cyan-500/30 bg-cyan-950/45 text-cyan-50/95 hover:border-cyan-500/50 hover:bg-cyan-500/[0.12] active:translate-y-[0.5px]",
                      "disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0",
                    )}
                  >
                    {applying ? (
                      <>
                        <Loader2
                          className={cn(
                            "h-3.5 w-3.5 shrink-0 animate-spin",
                            theme === "light"
                              ? "text-cyan-700"
                              : "text-cyan-400/80",
                          )}
                        />
                        Saving…
                      </>
                    ) : (
                      <>
                        <CircleCheck
                          className={cn(
                            "h-3.5 w-3.5 shrink-0",
                            theme === "light"
                              ? "text-cyan-700"
                              : "text-cyan-400/85",
                          )}
                        />
                        Apply command
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEditingCommand}
                    disabled={applying}
                    className={cn(
                      "inline-flex items-center justify-center gap-1.5 rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors",
                      "focus:outline-none focus:ring-1 focus:ring-zinc-500/30",
                      theme === "light"
                        ? "shadow-none ring-1 ring-inset ring-zinc-700/25 border-zinc-600/45 bg-zinc-800/50 text-zinc-700 hover:border-zinc-600/60 hover:bg-zinc-800/75"
                        : "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] border-zinc-700/55 bg-zinc-800/55 text-zinc-300 hover:border-zinc-600/75 hover:bg-zinc-800/90 hover:text-zinc-100",
                      "disabled:cursor-not-allowed disabled:opacity-45",
                    )}
                  >
                    <X className="h-3 w-3 shrink-0 text-zinc-500" />
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void startEditingCommand()}
                disabled={loadingEditLine || applying}
                aria-busy={loadingEditLine}
                className={cn(
                  theme === "light"
                    ? COMMAND_BOX_FRAME_LIGHT
                    : COMMAND_BOX_FRAME_DARK,
                  theme === "light"
                    ? "bg-zinc-800/50 text-left border-zinc-600/45 hover:border-cyan-400 hover:bg-cyan-50/90 hover:ring-cyan-500/20"
                    : "bg-zinc-950/40 text-left hover:border-cyan-500/35 hover:bg-zinc-950/70 hover:ring-cyan-500/15",
                  "focus:outline-none focus:ring-2",
                  theme === "light"
                    ? "focus:ring-cyan-500/35"
                    : "focus:ring-cyan-500/30",
                  "disabled:cursor-wait disabled:opacity-60",
                )}
              >
                <pre
                  className={cn(
                    theme === "light" ? COMMAND_TEXT_LIGHT : COMMAND_TEXT_DARK,
                    "pointer-events-none",
                  )}
                >
                  {shownPreviewCommand}
                </pre>
              </button>
            )}
          </div>
        </>
      )}

      {!builderResult && !builderError && !editingCommand && (
        <div className="px-3 py-3 text-sm text-zinc-500">Loading preview…</div>
      )}
    </div>
  );
}
