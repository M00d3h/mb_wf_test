import { useMemo } from "react";
import { TagChip } from "../shared/TagChip";
import { StatusBadge } from "../shared/StatusBadge";
import { VllmBrandAvatar } from "./VllmBrandAvatar";
import { FolderQuantProviderInline } from "./FolderQuantProviderInline";
import { cn } from "../../lib/utils";
import { guessHfPublisherSlugFromText } from "../../lib/hfModelPublisher";
import { resolveHfHubSegment, extractVllmQuantLabel, dtypeToLabel } from "../../lib/vllmModelPath";
import { useServerStore } from "../../store/serverStore";
import { useThemeStore } from "../../store/themeStore";
import type { VllmModel } from "@shared/types";

interface Props {
  model: VllmModel;
  selected: boolean;
  onClick: () => void;
}

export function VllmModelCard({ model, selected, onClick }: Props): JSX.Element {
  const { instances } = useServerStore();
  const { theme } = useThemeStore();

  const runningInst = instances.find(
    (i) =>
      i.instanceKind === "vllm" &&
      i.vllmModelId === model.id &&
      (i.state === "running" ||
        i.state === "loading" ||
        i.state === "starting" ||
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

  const quant = useMemo(
    () => extractVllmQuantLabel(displayTitle) ?? dtypeToLabel(model.dtype),
    [displayTitle, model.dtype],
  );

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left flex items-start gap-2 px-2.5 py-2 rounded-md border transition-colors",
        selected
          ? "bg-cyan-500/15 border-cyan-500/40 text-zinc-100"
          : theme === "light"
            ? "border border-zinc-700/20 bg-zinc-800/40 text-zinc-300 hover:border-zinc-600/45 hover:bg-zinc-800/65"
            : "border border-zinc-800 bg-zinc-900/40 text-zinc-300 hover:border-zinc-600",
      )}
    >
      <VllmBrandAvatar slug={publisherSlug} size="sm" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-tight truncate">{displayTitle}</div>
        <div className="flex flex-wrap gap-1 mt-1">
          {displayTitle.toUpperCase().includes("MOE") && (
            <TagChip label="MOE" variant="moe" />
          )}
          {quant && <TagChip label={quant} variant="quant" />}
          {hubSegment && (
            <FolderQuantProviderInline providerSlug={hubSegment.namespace} />
          )}
        </div>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1 pt-0.5">
        {runningInst && (
          <>
            <StatusBadge state={runningInst.state} className="text-[10px]" />
            <span className="text-[10px] text-green-400 font-mono">
              :{runningInst.port}
            </span>
          </>
        )}
      </div>
    </button>
  );
}
