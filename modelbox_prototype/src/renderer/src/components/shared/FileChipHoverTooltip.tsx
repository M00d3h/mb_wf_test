import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface Props {
  /** Full file name (chip may truncate in the child) */
  fileName: string;
  /** Exact `getFileTypeInfo(...).chip` string — same panel look as the chip */
  chipClassName: string;
  children: ReactNode;
  /** Extra classes on the positioning wrapper (e.g. `w-32`) */
  className?: string;
  /**
   * `center` — tooltip centered on chip (good for right-aligned bubbles).
   * `start` — tooltip aligned to chip’s left edge so long names extend right (avoids spilling into the sidebar in the composer).
   */
  tooltipAlign?: "center" | "start";
}

/**
 * Hover filename panel: uses the same `chip` classes as the file chip (tint + border), not a separate “solid” palette.
 */
export function FileChipHoverTooltip({
  fileName,
  chipClassName,
  children,
  className,
  tooltipAlign = "center",
}: Props): JSX.Element {
  return (
    <div className={cn("group/chip relative shrink-0", className)}>
      <div
        role="tooltip"
        className={cn(
          "pointer-events-none absolute bottom-full z-[60] mb-1.5 w-max text-left text-xs leading-snug",
          "border rounded-lg px-2.5 py-1.5 text-zinc-300",
          chipClassName,
          tooltipAlign === "start"
            ? "left-0 max-w-[min(18rem,calc(100vw-8rem))]"
            : "left-1/2 max-w-[min(22rem,calc(100vw-1.5rem))] -translate-x-1/2",
          "opacity-0 transition-opacity duration-200 ease-out",
          "group-hover/chip:opacity-100",
        )}
      >
        <span className="break-words [word-break:break-word]">{fileName}</span>
      </div>
      {children}
    </div>
  );
}
