import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { publisherNeedsWhiteAvatarBackground } from "../../lib/hfModelPublisher";
import { usePublisherAvatarUrl, loadedAvatarUrls } from "../../lib/usePublisherAvatarUrl";
import { cn } from "../../lib/utils";

/**
 * Tiny HF namespace avatar + folder label (from `modelsRoot/provider/...` layout).
 */
export function FolderQuantProviderInline({
  providerSlug,
}: {
  providerSlug: string;
}): JSX.Element {
  const url = usePublisherAvatarUrl(providerSlug);
  const [imgReady, setImgReady] = useState(() => url != null && loadedAvatarUrls.has(url));
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    if (url && loadedAvatarUrls.has(url)) {
      setImgReady(true);
    } else {
      setImgReady(false);
    }
    setImgFailed(false);
  }, [providerSlug, url]);

  const whiteDisc = publisherNeedsWhiteAvatarBackground(providerSlug);

  return (
    <span
      className="inline-flex items-center gap-0.5 min-w-0 max-w-full shrink"
      title={providerSlug}
    >
      <span
        className={cn(
          "relative inline-flex h-3 w-3 shrink-0 overflow-hidden rounded-full ring-1 ring-zinc-600/50",
          whiteDisc ? "bg-white" : "bg-zinc-800",
        )}
        aria-hidden
      >
        {url && !imgFailed ? (
          <img
            src={url}
            alt=""
            loading="lazy"
            decoding="async"
            className={cn(
              "absolute inset-0 h-full w-full",
              whiteDisc ? "object-contain" : "object-cover",
              !imgReady && "opacity-0",
            )}
            onLoad={() => {
              loadedAvatarUrls.add(url!);
              setImgReady(true);
            }}
            onError={() => {
              setImgFailed(true);
              setImgReady(false);
            }}
          />
        ) : null}
        <span
          className={cn(
            "flex h-full w-full items-center justify-center text-zinc-500",
            url && !imgFailed && imgReady && "hidden",
          )}
        >
          <Cpu className="h-2 w-2" strokeWidth={2} />
        </span>
      </span>
      <span className="text-[10px] text-zinc-400 font-medium truncate leading-none">
        {providerSlug}
      </span>
    </span>
  );
}
