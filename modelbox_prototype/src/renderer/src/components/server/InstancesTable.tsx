import { useState, useEffect } from "react";
import { Play, Square, RotateCcw, Copy, ExternalLink, X } from "lucide-react";
import { StatusBadge } from "../shared/StatusBadge";
import { ModelBrandAvatar } from "../chat/ModelBrandAvatar";
import { useServerStore } from "../../store/serverStore";
import { useModelsStore } from "../../store/modelsStore";
import { useThemeStore } from "../../store/themeStore";
import { useSettingsStore } from "../../store/settingsStore";
import { api } from "../../lib/ipc";
import { cn, formatUptime } from "../../lib/utils";
import type { ServerInstance } from "@shared/types";
import { VllmBrandAvatar } from "../models/VllmBrandAvatar";
import { guessHfPublisherSlugFromText } from "../../lib/hfModelPublisher";
import claudecodeColorIcon from "../../assets/claudecode-color.svg";
import vllmColorIcon from "../../assets/vllm-color.svg";
import llamacppIcon from "../../assets/llamacpp-icon.png";

interface Props {
  onSelectInstance: (id: string) => void;
  selectedId: string | null;
}

export function InstancesTable({
  onSelectInstance,
  selectedId,
}: Props): JSX.Element {
  const {
    instances,
    startServer,
    stopServer,
    restartServer,
    fetchInstances,
    clearInstance,
  } = useServerStore();
  const { models, profiles, fetchProfiles } = useModelsStore();
  const { theme } = useThemeStore();
  const wslMode = useSettingsStore((s) => s.settings?.wslMode ?? false);
  const [, setTick] = useState(0);
  const [localIp, setLocalIp] = useState("127.0.0.1");
  const [clickedClaudeIds, setClickedClaudeIds] = useState<Set<string>>(new Set());

  // Refresh uptime every second
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetchInstances();
  }, [fetchInstances]);

  // Fetch profiles for each GGUF model that has instances (needed for alias + profile name)
  useEffect(() => {
    const seen = new Set<string>();
    for (const inst of instances) {
      if (inst.instanceKind !== "llama" || !inst.modelId) continue;
      if (!seen.has(inst.modelId) && !profiles[inst.modelId]) {
        seen.add(inst.modelId);
        fetchProfiles(inst.modelId);
      }
    }
  }, [instances]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve the machine's LAN IP once on mount (used when host is 0.0.0.0)
  useEffect(() => {
    api.system
      .localIp()
      .then(setLocalIp)
      .catch(() => {});
  }, []);

  const getModelInfo = (
    inst: ServerInstance,
  ): { display: string; backend: string } => {
    if (inst.instanceKind === "vllm") {
      const full = inst.modelName ?? "vLLM";
      const display = vllmDisplayName(full);
      return { display, backend: full };
    }
    const modelId = inst.modelId!;
    const profileId = inst.profileId!;
    const model = models.find((m) => m.id === modelId);
    const backend = model?.name ?? modelId.slice(0, 8);
    const profile = (profiles[modelId] ?? []).find((p) => p.id === profileId);
    const display = profile?.config.alias?.trim() || backend;
    return { display, backend };
  };

  const getProfileName = (inst: ServerInstance): string => {
    if (inst.instanceKind === "vllm") {
      return inst.profileName ?? "vLLM";
    }
    const modelId = inst.modelId!;
    const profileId = inst.profileId!;
    const profile = (profiles[modelId] ?? []).find((p) => p.id === profileId);
    return profile?.name ?? profileId.slice(0, 8);
  };

  const getVllmSlug = (inst: ServerInstance): string | null =>
    inst.modelName ? guessHfPublisherSlugFromText(inst.modelName) : null;

  // Strip "org/" prefix so we show "Qwen3-8B" not "Qwen/Qwen3-8B"
  const vllmDisplayName = (name: string): string => {
    const idx = name.indexOf('/');
    return idx >= 0 ? name.slice(idx + 1) : name;
  };

  const resolveHost = (host: string): string =>
    host === "0.0.0.0" ? localIp : host;

  const copyUrl = (inst: ServerInstance): void => {
    navigator.clipboard.writeText(
      `http://${resolveHost(inst.host)}:${inst.port}`,
    );
  };

  const openDocs = (inst: ServerInstance): void => {
    window.open(`http://${resolveHost(inst.host)}:${inst.port}/docs`, "_blank");
  };

  const copyClaudeCodeEnv = async (
    inst: ServerInstance,
    modelDisplay: string,
  ): Promise<void> => {
    const baseUrl = `http://${resolveHost(inst.host)}:${inst.port}`;
    const apiKey = (await api.server.getApiKey(inst.host, inst.port)) ?? "";
    const useExport = window.platform !== "win32" || wslMode;
    const lines = !useExport
      ? [
          `$env:ANTHROPIC_BASE_URL="${baseUrl}"`,
          `$env:ANTHROPIC_AUTH_TOKEN="${apiKey}"`,
          `$env:ANTHROPIC_MODEL="${modelDisplay}"`,
          `$env:ANTHROPIC_SMALL_FAST_MODEL="${modelDisplay}"`,
          `$env:ANTHROPIC_DEFAULT_SONNET_MODEL="${modelDisplay}"`,
          `$env:ANTHROPIC_DEFAULT_OPUS_MODEL="${modelDisplay}"`,
          `$env:ANTHROPIC_DEFAULT_HAIKU_MODEL="${modelDisplay}"`,
          `claude`,
        ]
      : [
          `export ANTHROPIC_BASE_URL=${baseUrl}`,
          `export ANTHROPIC_AUTH_TOKEN=${apiKey}`,
          `export ANTHROPIC_MODEL=${modelDisplay}`,
          `export ANTHROPIC_SMALL_FAST_MODEL=${modelDisplay}`,
          `export ANTHROPIC_DEFAULT_SONNET_MODEL=${modelDisplay}`,
          `export ANTHROPIC_DEFAULT_OPUS_MODEL=${modelDisplay}`,
          `export ANTHROPIC_DEFAULT_HAIKU_MODEL=${modelDisplay}`,
          `claude`,
        ];
    navigator.clipboard.writeText(lines.join("\n"));
  };

  if (instances.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-zinc-600 text-base">
        No server instances. Start a model from the Models page.
      </div>
    );
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-base">
        <thead>
          <tr className="text-sm text-zinc-500 bg-zinc-900/50">
            <th className="text-left px-3 py-2 font-medium rounded-tl-lg">Model</th>
            <th className="text-left px-3 py-2 font-medium">Profile</th>
            <th className="text-left px-3 py-2 font-medium">Host:Port</th>
            <th className="text-left px-3 py-2 font-medium">PID</th>
            <th className="text-left px-3 py-2 font-medium">Uptime</th>
            <th className="text-left px-3 py-2 font-medium">State</th>
            <th className="text-left px-3 py-2 font-medium rounded-tr-lg">Actions</th>
          </tr>
        </thead>
        <tbody>
          {instances.map((inst) => {
            const model =
              inst.modelId != null
                ? models.find((m) => m.id === inst.modelId)
                : undefined;
            const modelInfo = getModelInfo(inst);
            const isEmbeddingModel = model?.isEmbedding ?? false;
            return (
              <tr
                key={inst.id}
                onClick={() => onSelectInstance(inst.id)}
                className={cn(
                  "cursor-pointer transition-colors",
                  theme === "light"
                    ? "hover:bg-zinc-800/65"
                    : "hover:bg-zinc-800/35",
                  selectedId === inst.id
                    ? theme === "light"
                      ? "bg-cyan-500/12"
                      : "bg-cyan-950/30"
                    : "odd:bg-zinc-900/[0.07]",
                )}
              >
                <td className="px-3 py-2 max-w-56">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 shrink-0">
                      {inst.instanceKind === "vllm" ? (
                        <VllmBrandAvatar slug={getVllmSlug(inst)} size="md" className="shrink-0" />
                      ) : (
                        <ModelBrandAvatar model={model} size="md" className="shrink-0" />
                      )}
                      <img
                        src={inst.instanceKind === "vllm" ? vllmColorIcon : llamacppIcon}
                        alt=""
                        className="h-4 w-4 shrink-0"
                      />
                    </div>
                    <span
                      className="text-zinc-200 text-base truncate min-w-0"
                      title={
                        modelInfo.display !== modelInfo.backend
                          ? modelInfo.backend
                          : undefined
                      }
                    >
                      {modelInfo.display}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(modelInfo.display);
                      }}
                      title={`Copy model ID: ${modelInfo.display}`}
                      className="shrink-0 p-0.5 text-zinc-600 hover:text-zinc-300"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </td>
                <td className="px-3 py-2 text-zinc-400 max-w-28 truncate">
                  {getProfileName(inst)}
                </td>
                <td className="px-3 py-2 font-mono text-sm text-zinc-300">
                  {inst.host}:{inst.port}
                </td>
                <td className="px-3 py-2 font-mono text-sm text-zinc-500">
                  {inst.pid ?? "—"}
                </td>
                <td className="px-3 py-2 text-sm text-zinc-400">
                  {inst.state === "running"
                    ? formatUptime(inst.startedAt)
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge state={inst.state} />
                </td>
                <td className="px-3 py-2">
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {inst.state === "stopped" || inst.state === "error" ? (
                      <button
                        title="Start"
                        onClick={() => {
                          if (
                            inst.instanceKind === "vllm" &&
                            inst.vllmProfileId
                          ) {
                            void api.vllm
                              .start(inst.vllmProfileId)
                              .then(() => fetchInstances());
                          } else if (inst.profileId) {
                            void startServer(inst.profileId);
                          }
                        }}
                        className="p-1 text-green-400 hover:bg-green-500/10 rounded"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        title="Stop"
                        onClick={() => stopServer(inst.id)}
                        className="p-1 text-red-400 hover:bg-red-500/10 rounded"
                      >
                        <Square className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      title="Restart"
                      onClick={() => restartServer(inst.id)}
                      className="p-1 text-zinc-400 hover:bg-zinc-700 rounded"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    <button
                      title="Copy base URL"
                      onClick={() => copyUrl(inst)}
                      className="p-1 text-zinc-400 hover:bg-zinc-700 rounded"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      title="Open API docs"
                      onClick={() => openDocs(inst)}
                      className="p-1 text-zinc-400 hover:bg-zinc-700 rounded"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                    {!isEmbeddingModel && (
                      <button
                        title="Use with Claude Code"
                        type="button"
                        onClick={() => {
                          copyClaudeCodeEnv(inst, modelInfo.display);
                          setClickedClaudeIds((prev) => new Set(prev).add(inst.id));
                          setTimeout(() => {
                            setClickedClaudeIds((prev) => {
                              const next = new Set(prev);
                              next.delete(inst.id);
                              return next;
                            });
                          }, 250);
                        }}
                        className="p-1 hover:bg-zinc-700 rounded inline-flex items-center justify-center shrink-0 mt-0.5"
                      >
                        <span
                          className={cn(
                            theme === "light"
                              ? "flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-white"
                              : "flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-black",
                            "transition-transform ease-out",
                            clickedClaudeIds.has(inst.id)
                              ? "duration-100 scale-75"
                              : "duration-300 scale-100",
                          )}
                        >
                          <img
                            src={claudecodeColorIcon}
                            alt="Claude Code"
                            className="h-full w-full object-contain"
                            draggable={false}
                          />
                        </span>
                      </button>
                    )}
                    {(inst.state === "error" || inst.state === "stopped") && (
                      <button
                        title="Clear"
                        onClick={() => clearInstance(inst.id)}
                        className={`p-1 rounded ${
                          inst.state === "error"
                            ? "text-red-400 hover:bg-red-500/10"
                            : "text-zinc-400 hover:bg-zinc-700"
                        }`}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
