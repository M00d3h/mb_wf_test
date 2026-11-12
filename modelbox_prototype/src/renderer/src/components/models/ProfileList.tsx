import { useEffect, useRef, useState } from "react";
import { Plus, Star, StarOff, Copy, Trash2 } from "lucide-react";
import { cn } from "../../lib/utils";
import { useModelsStore } from "../../store/modelsStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useThemeStore } from "../../store/themeStore";
import { useServerStore } from "../../store/serverStore";
import { ProfileEditor } from "./ProfileEditor";
import { LaunchCommandPanel } from "./LaunchCommandPanel";
import type { ProfileConfig } from "@shared/types";

interface Props {
  modelId: string;
}

export function ProfileList({ modelId }: Props): JSX.Element {
  const {
    models,
    profiles,
    createProfile,
    updateProfile,
    deleteProfile,
    setActiveProfile,
    duplicateProfile,
  } = useModelsStore();
  const { settings } = useSettingsStore();
  const instances = useServerStore((s) => s.instances);
  const resolvedModel = models.find((m) => m.id === modelId) ?? null;
  const { theme } = useThemeStore();
  const modelProfiles = profiles[modelId] ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [liveOverride, setLiveOverride] = useState<{ config: ProfileConfig; apiKey: string } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const prevModelIdRef = useRef(modelId);

  /** When switching models or when profiles finish loading, default to the active profile (same as clicking it). */
  useEffect(() => {
    const active = modelProfiles.find((p) => p.active);
    if (prevModelIdRef.current !== modelId) {
      prevModelIdRef.current = modelId;
      setSelectedId(active?.id ?? null);
      setLiveOverride(null);
      setConfirmDeleteId(null);
      return;
    }
    setSelectedId((prev) => {
      if (prev && modelProfiles.some((p) => p.id === prev)) return prev;
      return active?.id ?? null;
    });
  }, [modelId, modelProfiles]);

  // Clear live override whenever the selected profile changes so the launch
  // command preview doesn't carry the previous profile's config across.
  const prevSelectedIdRef = useRef(selectedId);
  useEffect(() => {
    if (prevSelectedIdRef.current !== selectedId) {
      prevSelectedIdRef.current = selectedId;
      setLiveOverride(null);
    }
  }, [selectedId]);

  const selectedProfile = modelProfiles.find((p) => p.id === selectedId);

  const handleCreate = async (): Promise<void> => {
    const profile = await createProfile(modelId, "New Profile", {
      host: settings?.llamaDefaultHost ?? "0.0.0.0",
      port: settings?.llamaBasePort ?? 8502,
    });
    setSelectedId(profile.id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]">
      <div
        className={cn(
          "rounded-xl p-3",
          theme === "light"
            ? "border border-zinc-700/35 bg-zinc-950/55 shadow-none ring-1 ring-zinc-700/20"
            : "border border-zinc-800/80 bg-zinc-900/40 ring-1 ring-white/[0.04] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]",
        )}
        aria-label="Profiles"
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Profiles
            </h3>
            <button
              type="button"
              onClick={handleCreate}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors",
                theme === "light"
                  ? "text-cyan-600 hover:bg-neutral-200/55 hover:text-cyan-500"
                  : "text-cyan-400 hover:bg-zinc-800/80 hover:text-cyan-300",
              )}
            >
              <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden />
              New
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          {modelProfiles.length === 0 && (
            <span className="text-xs text-zinc-600">
              No profiles yet — click New.
            </span>
          )}

          {modelProfiles.map((p) => {
            const isRunning = instances.some(
              (i) =>
                i.profileId === p.id &&
                (i.state === "running" || i.state === "starting" || i.state === "loading"),
            );
            const deleteBlocked = p.active || isRunning;
            return (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                setSelectedId(p.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedId(p.id);
                }
              }}
              className={cn(
                "group inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md cursor-pointer border transition-colors max-w-[14rem] shrink-0",
                selectedId === p.id
                  ? "bg-cyan-500/15 border-cyan-500/40 text-zinc-100"
                  : theme === "light"
                    ? "border border-zinc-700/20 bg-zinc-800/40 text-zinc-300 hover:border-zinc-600/45 hover:bg-zinc-800/65"
                    : "bg-zinc-800/40 border-transparent hover:border-zinc-700 text-zinc-300",
              )}
            >
              {isRunning && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-400 animate-pulse" aria-hidden />
              )}
              <span className="text-xs truncate min-w-0">{p.name}</span>
              {p.active && (
                <span
                  className={cn(
                    "text-[9px] border rounded px-1 py-0.5 shrink-0",
                    theme === "light"
                      ? "bg-green-100 text-green-700 border-green-300"
                      : "bg-green-500/20 text-green-400 border-green-500/30",
                  )}
                >
                  Active
                </span>
              )}
              {/*
                Keep actions in layout (opacity) instead of hidden/display toggling.
                Near wrap edges, width changes used to reflow the row and break hover → flicker loop.
              */}
              <div className="flex items-center gap-0.5 shrink-0 opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
                <button
                  type="button"
                  title={p.active ? "Active" : "Set active"}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveProfile(p.id, modelId);
                  }}
                  className="p-0.5 text-zinc-500 hover:text-yellow-400"
                >
                  {p.active ? (
                    <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                  ) : (
                    <StarOff className="w-3 h-3" />
                  )}
                </button>
                <button
                  type="button"
                  title="Duplicate"
                  onClick={(e) => {
                    e.stopPropagation();
                    duplicateProfile(p.id, modelId);
                  }}
                  className="p-0.5 text-zinc-500 hover:text-zinc-200"
                >
                  <Copy className="w-3 h-3" />
                </button>
                {confirmDeleteId === p.id ? (
                  <>
                    <span className={cn("text-[10px]", theme === "light" ? "text-zinc-400" : "text-zinc-500")}>
                      Delete?
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(null);
                        deleteProfile(p.id, modelId);
                        if (selectedId === p.id) setSelectedId(null);
                      }}
                      className={cn(
                        "rounded px-1 py-0.5 text-[10px] font-medium transition-colors",
                        theme === "light"
                          ? "bg-red-100 text-red-700 hover:bg-red-200"
                          : "bg-red-500/20 text-red-400 hover:bg-red-500/30",
                      )}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(null);
                      }}
                      className={cn(
                        "rounded px-1 py-0.5 text-[10px] font-medium transition-colors",
                        theme === "light"
                          ? "bg-zinc-300 text-zinc-700 hover:bg-zinc-400"
                          : "bg-zinc-700/60 text-zinc-400 hover:bg-zinc-700",
                      )}
                    >
                      No
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    title={
                      p.active
                        ? "Active profile cannot be deleted"
                        : isRunning
                          ? "Stop the model first"
                          : "Delete"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (deleteBlocked) return;
                      setConfirmDeleteId(p.id);
                    }}
                    className={cn(
                      "p-0.5",
                      deleteBlocked
                        ? theme === "light"
                          ? "cursor-default text-zinc-400"
                          : "cursor-default text-zinc-700"
                        : theme === "light"
                          ? "text-zinc-600 hover:text-red-600"
                          : "text-zinc-500 hover:text-red-400",
                    )}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          );
          })}
          </div>
        </div>
      </div>

      {selectedProfile ? (
        <>
          <div className="min-w-0 shrink-0">
            <LaunchCommandPanel
              profile={
                modelProfiles.find((p) => p.id === selectedId) ??
                selectedProfile
              }
              liveConfig={liveOverride?.config}
              liveApiKey={liveOverride?.apiKey}
            />
          </div>
          <div className="min-w-0 shrink-0">
            <ProfileEditor
              key={selectedProfile.id}
              profile={
                modelProfiles.find((p) => p.id === selectedId) ??
                selectedProfile
              }
              model={resolvedModel}
              onPersist={async (patch) => {
                await updateProfile(selectedProfile.id, patch);
              }}
              onLiveChange={setLiveOverride}
            />
          </div>
          <p className="shrink-0 pb-1 text-xs text-zinc-600">
            Changes save automatically. The launch command preview updates in real time.
          </p>
        </>
      ) : (
        <div className="flex min-h-[6rem] items-center justify-center text-center text-zinc-600 text-sm">
          Select a profile to configure launch options
        </div>
      )}
    </div>
  );
}
