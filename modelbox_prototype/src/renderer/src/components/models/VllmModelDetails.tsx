import { useEffect, useMemo, useState } from "react";
import { Trash2, Square } from "lucide-react";
import { useVllmStore } from "../../store/vllmStore";
import { useServerStore } from "../../store/serverStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useThemeStore } from "../../store/themeStore";
import { cn } from "../../lib/utils";
import { guessHfPublisherSlugFromText } from "../../lib/hfModelPublisher";
import { resolveHfHubSegment } from "../../lib/vllmModelPath";
import { VllmBrandAvatar } from "./VllmBrandAvatar";
import { FolderQuantProviderInline } from "./FolderQuantProviderInline";
import { VllmProfileList } from "./VllmProfileList";
import { LaunchVllmProfileButton } from "./LaunchVllmProfileButton";
import type { VllmModel } from "@shared/types";

interface Props {
  model: VllmModel;
}

export function VllmModelDetails({ model }: Props): JSX.Element {
  const { theme } = useThemeStore();
  const { deleteModel, fetchProfiles, profiles } = useVllmStore();
  const { settings } = useSettingsStore();
  const { instances, stopServer } = useServerStore();

  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);

  useEffect(() => {
    void fetchProfiles(model.id);
  }, [model.id, fetchProfiles]);

  const modelProfiles = profiles[model.id] ?? [];
  const modelProfileIds = new Set(modelProfiles.map((p) => p.id));

  const vllmInst = instances.find(
    (i) =>
      i.instanceKind === "vllm" &&
      i.vllmProfileId !== null &&
      modelProfileIds.has(i.vllmProfileId) &&
      (i.state === "running" ||
        i.state === "starting" ||
        i.state === "loading" ||
        i.state.startsWith("vllm-")),
  );

  const hubSegment = useMemo(
    () => resolveHfHubSegment(model.path, model.displayName),
    [model.path, model.displayName],
  );

  const displayTitle = hubSegment?.modelName ?? model.displayName;

  const publisherSlug = useMemo(
    () => guessHfPublisherSlugFromText(`${displayTitle}\n${model.path}`),
    [displayTitle, model.path],
  );

  const rootDirLabel = useMemo(() => {
    const dirs = settings?.vllmModelDirs ?? [];
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/$/, "");
    const mp = norm(model.path);
    return (
      dirs.find((d) =>
        mp.toLowerCase().startsWith(norm(d).toLowerCase()),
      ) ?? model.path
    );
  }, [model.path, settings?.vllmModelDirs]);

  const diskSizeLabel = useMemo(() => {
    const b = model.diskSize ?? 0;
    if (b <= 0) return null;
    return `${(b / 1e9).toFixed(2)} GB`;
  }, [model.diskSize]);

  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(null);
    setConfirmDelete(false);
    try {
      await deleteModel(model.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDeleteError(msg);
    } finally {
      setDeleting(false);
    }
  };

  const isLight = theme === "light";

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div
        className={cn(
          "shrink-0 bg-gradient-to-b to-transparent px-5 py-4",
          isLight ? "from-zinc-950/50" : "from-zinc-900/50",
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <VllmBrandAvatar
            slug={publisherSlug}
            size="md"
            className="mt-0.5 shrink-0"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex min-w-0 items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-0.5">
                  <h2 className="min-w-0 truncate text-base font-semibold tracking-tight text-zinc-100">
                    {displayTitle}
                  </h2>
                  {diskSizeLabel && (
                    <span
                      className={cn(
                        'text-xs font-normal shrink-0',
                        isLight ? 'text-zinc-500/90' : 'text-zinc-400/55',
                      )}
                    >
                      {diskSizeLabel}
                    </span>
                  )}
                  <span
                    title={model.path}
                    className={cn(
                      "max-w-[14rem] cursor-default truncate text-xs font-normal",
                      isLight ? "text-zinc-500/70" : "text-zinc-500/80",
                    )}
                  >
                    {rootDirLabel}
                  </span>
                </div>
                {confirmDelete ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={cn("text-xs", isLight ? "text-zinc-500" : "text-zinc-400")}>
                      Delete?
                    </span>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => void handleDelete()}
                      className={cn(
                        "rounded px-1.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50",
                        isLight
                          ? "bg-red-100 text-red-700 hover:bg-red-200"
                          : "bg-red-500/20 text-red-400 hover:bg-red-500/30",
                      )}
                    >
                      {deleting ? "…" : "Yes"}
                    </button>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => setConfirmDelete(false)}
                      className={cn(
                        "rounded px-1.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50",
                        isLight
                          ? "bg-zinc-300 text-zinc-700 hover:bg-zinc-400 hover:text-zinc-900"
                          : "bg-zinc-700/60 text-zinc-400 hover:bg-zinc-700",
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
                      "shrink-0 rounded-lg p-1.5 transition-colors",
                      isLight
                        ? "text-red-600 hover:bg-red-50 hover:text-red-700"
                        : "text-red-400/90 hover:bg-red-950/35 hover:text-red-300",
                    )}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
              {hubSegment ? (
                <div className="min-w-0">
                  <FolderQuantProviderInline
                    providerSlug={hubSegment.namespace}
                  />
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <LaunchVllmProfileButton
                vllmModelId={model.id}
                onErrorChange={setLaunchError}
              />
              {vllmInst && (
                <button
                  title="Stop"
                  onClick={() => stopServer(vllmInst.id)}
                  className="p-1 text-red-400 hover:bg-red-500/10 rounded"
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {(launchError ?? deleteError) ? (
              <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-400">
                {launchError ?? deleteError}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-2">
        <VllmProfileList vllmModelId={model.id} />
      </div>
    </div>
  );
}
