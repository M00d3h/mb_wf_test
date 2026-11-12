import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useThemeStore } from "../../store/themeStore";
import { cn } from "../../lib/utils";
import { StreamingText } from "../shared/StreamingText";

type TipPos = { left: number; top: number; maxW: number };

function computeTip(el: HTMLElement): TipPos | null {
  if (el.scrollWidth <= el.clientWidth + 1) return null;
  const r = el.getBoundingClientRect();
  const maxW = Math.min(320, Math.max(240, window.innerWidth - 16));
  const left = Math.max(8, Math.min(r.left, window.innerWidth - maxW - 8));
  return { left, top: r.bottom + 6, maxW };
}

export function SidebarChatTitle({ text }: { text: string }): JSX.Element {
  const isLight = useThemeStore((s) => s.theme === "light");
  const textRef = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<TipPos | null>(null);

  useLayoutEffect(() => {
    if (!tip) return;
    const onScroll = (): void => setTip(null);
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [tip]);

  return (
    <>
      <div
        className="flex-1 min-w-0"
        onMouseEnter={() => {
          requestAnimationFrame(() => {
            const el = textRef.current;
            if (!el) return;
            const next = computeTip(el);
            setTip(next);
          });
        }}
        onMouseLeave={() => setTip(null)}
      >
        <StreamingText
          ref={textRef}
          text={text}
          className="block min-w-0 truncate text-sm"
        />
      </div>
      {tip &&
        createPortal(
          <div
            className={cn(
              "pointer-events-none fixed z-[100] rounded-lg px-2.5 py-1.5 text-sm leading-snug",
              isLight
                ? "border border-neutral-200/90 bg-white text-neutral-900 shadow-sm shadow-neutral-900/10 ring-1 ring-black/[0.05]"
                : "border border-zinc-700/80 bg-zinc-900/95 text-zinc-100 shadow-xl shadow-black/50 ring-1 ring-white/[0.06] backdrop-blur-sm",
            )}
            style={{ left: tip.left, top: tip.top, maxWidth: tip.maxW }}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
