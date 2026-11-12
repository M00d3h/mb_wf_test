import { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { publisherNeedsWhiteAvatarBackground } from "../../lib/hfModelPublisher";
import { usePublisherAvatarUrl, loadedAvatarUrls } from "../../lib/usePublisherAvatarUrl";
import { cn } from "../../lib/utils";

type Size = "sm" | "md";

const sizeClass: Record<Size, string> = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
};

const iconSize: Record<Size, string> = {
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5",
};

/** HF org avatar for a vLLM model — accepts the publisher slug directly. */
export function VllmBrandAvatar({
  slug,
  size = "sm",
  className,
}: {
  slug: string | null;
  size?: Size;
  className?: string;
}): JSX.Element {
  const url = usePublisherAvatarUrl(slug);
  const [imgReady, setImgReady] = useState(() => url != null && loadedAvatarUrls.has(url));
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    if (url && loadedAvatarUrls.has(url)) {
      setImgReady(true);
    } else {
      setImgReady(false);
    }
    setImgFailed(false);
  }, [slug, url]);

  const whiteDisc = slug != null && publisherNeedsWhiteAvatarBackground(slug);

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-full ring-1 ring-zinc-600/50",
        whiteDisc ? "bg-white" : "bg-zinc-800",
        sizeClass[size],
        className,
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
            if (url) loadedAvatarUrls.add(url);
            setImgReady(true);
          }}
          onError={() => {
            setImgFailed(true);
            setImgReady(false);
          }}
        />
      ) : null}
      <div
        className={cn(
          "flex h-full w-full items-center justify-center text-zinc-500",
          url && !imgFailed && imgReady && "hidden",
        )}
      >
        <Cpu className={iconSize[size]} strokeWidth={2} />
      </div>
    </div>
  );
}
