import { useState, useEffect, useRef } from "react";
import { ChevronDown, Search, Square } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useServerStore } from "../../store/serverStore";
import { useModelsStore } from "../../store/modelsStore";
import { useChatStore } from "../../store/chatStore";
import { useVllmStore } from "../../store/vllmStore";
import { useVllmSetupStore } from "../../store/vllmSetupStore";
import { useSettingsStore } from "../../store/settingsStore";
import { isVllmConfigured } from "../../lib/runtimeUtils";
import { cn } from "../../lib/utils";
import { useThemeStore } from "../../store/themeStore";
import { api } from "../../lib/ipc";
import { conversationMatchesInstance, isActiveState } from "../../lib/serverInstanceMatch";
import { ModelBrandAvatar } from "./ModelBrandAvatar";
import { VllmBrandAvatar } from "../models/VllmBrandAvatar";
import { guessHfPublisherSlugFromText } from "../../lib/hfModelPublisher";
import { resolveHfHubSegment } from "../../lib/vllmModelPath";
import { serverStateBadgeConfig } from "../shared/StatusBadge";
import vllmColorIcon from "../../assets/vllm-color.svg";
import llamacppIcon from "../../assets/llamacpp-icon.png";

const isMacOs = window.platform === 'darwin';

import type { ServerInstance } from "@shared/types";

interface Props {
  conversationId: string;
}

export function ModelPicker({ conversationId }: Props): JSX.Element {
  const { theme } = useThemeStore();
  const { instances, setPreferredInstance, startServer, stopServer, fetchInstances } = useServerStore();
  const { models, profiles } = useModelsStore();
  const { conversations, draftConv, updateConversation } = useChatStore();
  const { models: vllmModels, profiles: vllmProfiles, fetchProfiles: fetchVllmProfiles } = useVllmStore();
  const { runtimeInfo } = useVllmSetupStore();
  const { settings } = useSettingsStore();
  const vllmInstalled = isVllmConfigured(settings, runtimeInfo);

  const [optimisticInstId, setOptimisticInstId] = useState<string | null>(null);
  const [librarySearch, setLibrarySearch] = useState("");
  const [open, setOpen] = useState(false);
  const [localIp, setLocalIp] = useState("127.0.0.1");
  const launchingRef = useRef<Record<string, boolean>>({});
  const launchingVllmRef = useRef<Record<string, boolean>>({});
  const prevRunningIdsRef = useRef<Set<string>>(new Set());
  const { fetchProfiles } = useModelsStore();

  useEffect(() => {
    api.system.localIp().then(setLocalIp).catch(() => {});
  }, []);

  useEffect(() => {
    setOptimisticInstId(null);
  }, [conversationId]);

  const conv = conversations.find((c) => c.id === conversationId)
    ?? (draftConv?.id === conversationId ? draftConv : undefined);
  const runningInstances = instances.filter((i) => isActiveState(i.state));

  // Once the store has caught up with our optimistic pick, clear it.
  useEffect(() => {
    if (!optimisticInstId) return;
    if (conv?.instanceId === optimisticInstId) setOptimisticInstId(null);
  }, [conv?.instanceId, optimisticInstId]);

  /** Active profile alias when set, else the GGUF display name. Used for the closed trigger and for running/started instances. */
  const getModelDisplayName = (modelId: string): string => {
    const modelProfiles = profiles[modelId] ?? [];
    const activeProfile = modelProfiles.find((p) => p.active);
    const alias = activeProfile?.config.alias;
    if (alias) return alias;
    const model = models.find((m) => m.id === modelId);
    return model?.name ?? modelId.slice(0, 16);
  };

  const getRunningInstanceLabel = (inst: ServerInstance): string => {
    if (inst.instanceKind === "vllm") {
      const full = inst.modelName ?? "vLLM";
      const idx = full.indexOf('/');
      return idx >= 0 ? full.slice(idx + 1) : full;
    }
    if (inst.modelId) {
      return getModelDisplayName(inst.modelId);
    }
    return "Server";
  };

  const handleSelect = (inst: {
    id: string;
    host: string;
    port: number;
    modelId: string | null;
  }): void => {
    setOptimisticInstId(inst.id);
    setPreferredInstance(inst.id);
    updateConversation(conversationId, {
      instanceId: inst.id,
      instanceHost: inst.host,
      instancePort: inst.port,
      modelId: inst.modelId,
    });
  };

  // Prefer optimistic selection → instanceId → host:port fallback.
  const resolvedInstId = optimisticInstId ?? conv?.instanceId ?? null;
  const currentInstance =
    (resolvedInstId
      ? runningInstances.find((i) => i.id === resolvedInstId)
      : null) ??
    runningInstances.find((i) =>
      conversationMatchesInstance(conv?.instanceHost, conv?.instancePort, i),
    );
  /** When the server binds 0.0.0.0, show a reachable LAN address (same scoring as server table). */
  const displayHost = (h: string): string => (h === "0.0.0.0" ? localIp : h);

  const triggerLabel = currentInstance
    ? getRunningInstanceLabel(currentInstance)
    : "Select a model";

  const triggerModel = currentInstance
    ? models.find((m) => m.id === currentInstance.modelId)
    : undefined;

  const getVllmSlug = (modelName: string | undefined): string | null =>
    modelName ? guessHfPublisherSlugFromText(modelName) : null;

  const chatableInstances = runningInstances.filter((inst) => {
    if (inst.instanceKind === "vllm") return true;
    const model = models.find((m) => m.id === inst.modelId);
    return model ? !model.isEmbedding : true;
  });

  useEffect(() => {
    const currentRunning = new Set(
      chatableInstances.filter((i) => i.state === "running").map((i) => i.id),
    );
    if (open) {
      const hasNew = [...currentRunning].some((id) => !prevRunningIdsRef.current.has(id));
      if (hasNew) setOpen(false);
    }
    prevRunningIdsRef.current = currentRunning;
  }, [chatableInstances, open]);

  // Transition state machine: exit old content, then enter new content.
  const hasRunning = chatableInstances.length > 0;
  const [renderedHasRunning, setRenderedHasRunning] = useState(hasRunning);
  const [listPhase, setListPhase] = useState<"stable" | "exit" | "enter">("stable");
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hasRunning === renderedHasRunning) return;
    if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    setListPhase("exit");
    transitionTimerRef.current = setTimeout(() => {
      setRenderedHasRunning(hasRunning);
      setListPhase("enter");
      transitionTimerRef.current = setTimeout(() => setListPhase("stable"), 440);
    }, 230);
    return () => { if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current); };
  }, [hasRunning, renderedHasRunning]);

  const libraryModels = models.filter((m) => !m.isEmbedding);
  const filteredLibraryModels = librarySearch.trim()
    ? libraryModels.filter((m) =>
        m.name.toLowerCase().includes(librarySearch.toLowerCase()),
      )
    : libraryModels;

  const filteredVllmModels = librarySearch.trim()
    ? vllmModels.filter((m) =>
        (m.displayName ?? m.path).toLowerCase().includes(librarySearch.toLowerCase()),
      )
    : vllmModels;

  const handleLaunch = async (modelId: string): Promise<void> => {
    if (launchingRef.current[modelId]) return;
    const activeProfile = (profiles[modelId] ?? []).find((p) => p.active);
    if (!activeProfile) return;
    launchingRef.current[modelId] = true;
    try {
      await startServer(activeProfile.id);
    } finally {
      launchingRef.current[modelId] = false;
    }
  };

  const handleVllmLaunch = async (vllmModelId: string): Promise<void> => {
    if (!vllmInstalled) return;
    if (launchingVllmRef.current[vllmModelId]) return;
    const activeProfile = (vllmProfiles[vllmModelId] ?? []).find((p) => p.active);
    if (!activeProfile) return;
    launchingVllmRef.current[vllmModelId] = true;
    try {
      await api.vllm.start(activeProfile.id);
      await fetchInstances();
    } finally {
      launchingVllmRef.current[vllmModelId] = false;
    }
  };

  return (
    <div className="min-w-0 max-w-[min(16rem,calc(100vw-8rem))] shrink">
      <DropdownMenu.Root
        modal={false}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) { setLibrarySearch(""); return; }
          if (chatableInstances.length === 0) {
            libraryModels.forEach((m) => {
              if (!profiles[m.id]) void fetchProfiles(m.id);
            });
            vllmModels.forEach((m) => {
              if (!vllmProfiles[m.id]) void fetchVllmProfiles(m.id);
            });
          }
        }}
      >
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className={cn(
              "group flex h-9 w-full min-w-[11rem] max-w-full items-center gap-2 rounded-xl border border-zinc-700/60 bg-zinc-800/80 px-3 text-left text-sm text-zinc-100",
              "transition-colors",
              theme === "light"
                ? "shadow-none ring-1 ring-inset ring-zinc-700/20"
                : "shadow-sm shadow-black/20",
              "hover:border-zinc-600 hover:bg-zinc-800",
              "focus:outline-none focus-visible:border-cyan-500/50 focus-visible:ring-2 focus-visible:ring-cyan-500/20",
              "data-[state=open]:border-cyan-500/40 data-[state=open]:bg-zinc-800",
            )}
          >
            {currentInstance?.instanceKind === "vllm" ? (
              <VllmBrandAvatar
                slug={getVllmSlug(currentInstance.modelName)}
                size="md"
                className="shrink-0 ring-zinc-600/50 group-data-[state=open]:ring-cyan-500/25"
              />
            ) : (
              <ModelBrandAvatar
                model={triggerModel}
                size="md"
                className="shrink-0 ring-zinc-600/50 group-data-[state=open]:ring-cyan-500/25"
              />
            )}
            <span
              className="min-w-0 flex-1 truncate text-sm font-medium"
              title={triggerLabel}
            >
              {triggerLabel}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200 group-data-[state=open]:rotate-180 group-data-[state=open]:text-zinc-400" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            collisionPadding={12}
            style={{
              width:
                "min(24rem, max(18rem, var(--radix-dropdown-menu-trigger-width)))",
              maxWidth: "min(24rem, calc(100vw - 2rem))",
            }}
            className={cn(
              "picker-content z-50 flex max-h-[min(20rem,calc(100vh-6rem))] flex-col overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-900/95 py-1 backdrop-blur-md",
              theme === "light"
                ? "shadow-sm shadow-black/10"
                : "shadow-2xl shadow-black/50",
            )}
          >
            <div className="shrink-0 px-2.5 py-1.5 bg-zinc-900/50">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                {renderedHasRunning ? "Running Models" : "Model Library"}
              </p>
            </div>

            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col overflow-hidden",
                listPhase === "exit" && "picker-list-exit",
                listPhase === "enter" && "picker-list-enter",
              )}
            >
              {!renderedHasRunning && (
                <div className="shrink-0 px-2 pb-1 pt-0.5">
                  <div className="flex items-center gap-1.5 rounded-lg border border-zinc-700/60 bg-zinc-800/60 px-2.5 py-1.5">
                    <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                    <input
                      type="text"
                      value={librarySearch}
                      onChange={(e) => setLibrarySearch(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      placeholder="Search models…"
                      className="min-w-0 flex-1 bg-transparent text-xs text-zinc-100 outline-none placeholder:text-zinc-500"
                    />
                  </div>
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-1 pb-1 pt-0.5 [scrollbar-gutter:stable]">
              {renderedHasRunning ? (
                <DropdownMenu.Group>
                  {chatableInstances.map((inst) => {
                    const isSelected = resolvedInstId
                      ? inst.id === resolvedInstId
                      : conversationMatchesInstance(
                          conv?.instanceHost,
                          conv?.instancePort,
                          inst,
                        );
                    const label = inst.instanceKind === "vllm"
                      ? (inst.modelName ?? "vLLM")
                      : getRunningInstanceLabel(inst);
                    const portLine = `${displayHost(inst.host)}:${inst.port}`;
                    const rowModel =
                      inst.modelId != null
                        ? models.find((m) => m.id === inst.modelId)
                        : undefined;
                    const badgeCfg = serverStateBadgeConfig[inst.state] ?? serverStateBadgeConfig.unknown;
                    return (
                      <DropdownMenu.Item
                        key={inst.id}
                        onSelect={() =>
                          handleSelect({
                            id: inst.id,
                            host: inst.host,
                            port: inst.port,
                            modelId: inst.modelId,
                          })
                        }
                        className={cn(
                          "relative flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-2 text-sm outline-none",
                          "text-zinc-200 data-[highlighted]:bg-zinc-800 data-[highlighted]:text-zinc-50",
                          "focus:bg-zinc-800",
                          isSelected && "bg-zinc-800/50",
                        )}
                      >
                        {inst.instanceKind === "vllm" ? (
                          <VllmBrandAvatar slug={getVllmSlug(inst.modelName)} size="sm" className="shrink-0" />
                        ) : (
                          <ModelBrandAvatar model={rowModel} size="sm" className="shrink-0" />
                        )}
                        <div
                          className="min-w-0 flex-1 text-left"
                          title={`${label} — ${portLine}`}
                        >
                          <div
                            className={cn(
                              "font-medium leading-snug text-zinc-100",
                              "whitespace-normal break-words [overflow-wrap:anywhere]",
                              "line-clamp-2",
                            )}
                          >
                            {label}
                          </div>
                          <div className="text-[11px] font-mono text-zinc-500 tabular-nums">
                            {portLine}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                              theme === "light" ? badgeCfg.light : badgeCfg.dark,
                            )}
                          >
                            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", badgeCfg.dot)} aria-hidden />
                            {badgeCfg.label}
                          </span>
                          <button
                            type="button"
                            title="Stop model"
                            onClick={(e) => {
                              e.stopPropagation();
                              void stopServer(inst.id);
                            }}
                            className="p-1 text-red-400 hover:bg-red-500/10 rounded"
                          >
                            <Square className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </DropdownMenu.Item>
                    );
                  })}
                </DropdownMenu.Group>
              ) : (filteredLibraryModels.length > 0 || (!isMacOs && filteredVllmModels.length > 0)) ? (
                <DropdownMenu.Group>
                  {filteredLibraryModels.map((model) => {
                    const modelProfiles = profiles[model.id] ?? [];
                    const activeProfile = modelProfiles.find((p) => p.active);
                    const inst = activeProfile
                      ? instances.find((i) => i.profileId === activeProfile.id)
                      : undefined;
                    const instState = inst?.state;
                    const isStarting = instState === "starting" || instState === "loading";
                    const isRunning = instState === "running";
                    const showBadge = isStarting || isRunning;
                    const badgeCfg = instState && serverStateBadgeConfig[instState]
                      ? serverStateBadgeConfig[instState]
                      : serverStateBadgeConfig.unknown;
                    const useAliasInLibrary =
                      inst != null &&
                      (instState === "starting" ||
                        instState === "loading" ||
                        instState === "running" ||
                        instState === "error");
                    const label = useAliasInLibrary ? getModelDisplayName(model.id) : model.name;
                    return (
                      <DropdownMenu.Item
                        key={model.id}
                        onSelect={(e) => {
                          e.preventDefault();
                          if (activeProfile && !isStarting && !isRunning) void handleLaunch(model.id);
                        }}
                        className={cn(
                          "relative flex select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none",
                          "text-zinc-200 data-[highlighted]:bg-zinc-800 data-[highlighted]:text-zinc-50 focus:bg-zinc-800",
                          activeProfile && !isStarting && !isRunning ? "cursor-pointer" : "cursor-default",
                          isStarting && "cursor-wait",
                        )}
                      >
                        <div className="flex items-center gap-1 shrink-0">
                          <ModelBrandAvatar model={model} size="sm" />
                          <img src={llamacppIcon} alt="" className="h-4 w-4 shrink-0" />
                        </div>
                        <span
                          title={label}
                          className="min-w-0 flex-1 truncate text-left text-xs font-medium leading-snug text-zinc-100"
                        >
                          {label}
                        </span>
                        {showBadge && (
                          <span
                            className={cn(
                              "shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                              theme === "light" ? badgeCfg.light : badgeCfg.dark,
                            )}
                          >
                            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", badgeCfg.dot)} aria-hidden />
                            {badgeCfg.label}
                          </span>
                        )}
                        {!activeProfile && (
                          <span className="shrink-0 text-[11px] text-zinc-600">No profile</span>
                        )}
                      </DropdownMenu.Item>
                    );
                  })}
                  {!isMacOs && filteredVllmModels.map((vllmModel) => {
                    const vllmModelProfiles = vllmProfiles[vllmModel.id] ?? [];
                    const activeVllmProfile = vllmModelProfiles.find((p) => p.active);
                    const vllmInst = activeVllmProfile
                      ? instances.find((i) => i.vllmProfileId === activeVllmProfile.id)
                      : undefined;
                    const vllmInstState = vllmInst?.state;
                    const isVllmStarting = vllmInstState === "starting" || vllmInstState === "loading";
                    const isVllmRunning = vllmInstState === "running";
                    const showVllmBadge = isVllmStarting || isVllmRunning;
                    const vllmBadgeCfg = vllmInstState && serverStateBadgeConfig[vllmInstState]
                      ? serverStateBadgeConfig[vllmInstState]
                      : serverStateBadgeConfig.unknown;
                    const vllmHubSeg = resolveHfHubSegment(vllmModel.path, vllmModel.displayName);
                    const vllmLabel = vllmHubSeg?.modelName ?? vllmModel.displayName;
                    const vllmSlug = guessHfPublisherSlugFromText(`${vllmLabel}\n${vllmModel.path}`);
                    const canLaunch = vllmInstalled && !!activeVllmProfile && !isVllmStarting && !isVllmRunning;
                    return (
                      <DropdownMenu.Item
                        key={vllmModel.id}
                        onSelect={(e) => {
                          e.preventDefault();
                          if (canLaunch) void handleVllmLaunch(vllmModel.id);
                        }}
                        className={cn(
                          "relative flex select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none",
                          "text-zinc-200 data-[highlighted]:bg-zinc-800 data-[highlighted]:text-zinc-50 focus:bg-zinc-800",
                          !vllmInstalled ? "opacity-50 cursor-not-allowed data-[highlighted]:bg-transparent data-[highlighted]:text-zinc-200" :
                            canLaunch ? "cursor-pointer" : "cursor-default",
                          isVllmStarting && "cursor-wait",
                        )}
                      >
                        <div className="flex items-center gap-1 shrink-0">
                          <VllmBrandAvatar slug={vllmSlug} size="sm" />
                          <img src={vllmColorIcon} alt="" className="h-4 w-4 shrink-0" />
                        </div>
                        <span
                          title={vllmLabel}
                          className="min-w-0 flex-1 truncate text-left text-xs font-medium leading-snug text-zinc-100"
                        >
                          {vllmLabel}
                        </span>
                        {showVllmBadge && vllmInstalled && (
                          <span
                            className={cn(
                              "shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                              theme === "light" ? vllmBadgeCfg.light : vllmBadgeCfg.dark,
                            )}
                          >
                            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", vllmBadgeCfg.dot)} aria-hidden />
                            {vllmBadgeCfg.label}
                          </span>
                        )}
                        {!vllmInstalled && (
                          <span className="shrink-0 text-[11px] text-zinc-600">vLLM not installed</span>
                        )}
                        {vllmInstalled && !activeVllmProfile && (
                          <span className="shrink-0 text-[11px] text-zinc-600">No profile</span>
                        )}
                      </DropdownMenu.Item>
                    );
                  })}
                </DropdownMenu.Group>
              ) : (
                <div className="px-2.5 py-4 text-center">
                  <p className="text-xs text-zinc-500">No models match your search.</p>
                </div>
              )}
              </div>
            </div>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
