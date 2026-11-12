import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { nord } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  LIGHT_CODE_SURFACE,
  lightModePrismStyle,
} from "../../lib/lightCodeThemes";
import {
  ChevronDown,
  Brain,
  FileText,
  Copy,
  Check,
  Pencil,
  Trash2,
  RefreshCw,
  Gauge,
  Hash,
  Clock,
  Layers,
  Hourglass,
  CircleAlert,
  type LucideIcon,
} from "lucide-react";
import { Icon } from "@iconify/react";
import { useChatStore } from "../../store/chatStore";
import { useThemeStore } from "../../store/themeStore";
import { cn } from "../../lib/utils";
import { getFileTypeInfo } from "../../lib/fileTypeIcons";
import { ImageLightbox } from "../shared/ImageLightbox";
import { DocumentPreviewModal } from "../shared/DocumentPreviewModal";
import { PdfPagesPreviewModal } from "../shared/PdfPagesPreviewModal";
import { FileChipHoverTooltip } from "../shared/FileChipHoverTooltip";
import { ToolCallBlock } from "./ToolCallBlock";
import { ToolResultBlock } from "./ToolResultBlock";
import type { Message } from "@shared/types";

// ── Content parsing ───────────────────────────────────────────────────────────

interface ParsedContent {
  thinkContent: string;
  isThinking: boolean; // inside <think>, </think> not yet seen
  thinkDone: boolean; // </think> was found
  responseContent: string;
}

function parseContent(raw: string): ParsedContent {
  const OPEN = "<think>";
  const CLOSE = "</think>";

  // Collect all complete <think>...</think> blocks
  const completeRe = /<think>([\s\S]*?)<\/think>/g;
  const thinkParts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = completeRe.exec(raw)) !== null) {
    thinkParts.push(m[1]);
  }

  // Check for an unclosed <think> at the tail (streaming in progress)
  const lastOpenIdx = raw.lastIndexOf(OPEN);
  const lastCloseIdx = raw.lastIndexOf(CLOSE);
  const hasUnclosedThink = lastOpenIdx !== -1 && lastOpenIdx > lastCloseIdx;

  if (hasUnclosedThink) {
    const liveContent = raw.slice(lastOpenIdx + OPEN.length);
    // responseContent is everything before the unclosed <think>, with any complete blocks stripped
    const responseContent = raw
      .slice(0, lastOpenIdx)
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .trimStart();
    return {
      thinkContent: [...thinkParts, liveContent].join("\n\n"),
      isThinking: true,
      thinkDone: false,
      responseContent,
    };
  }

  // vLLM prefix-<think> case: the chat template added <think> to the generation
  // prefix so it never appears in the model's output stream. Content arrives as
  // "thinking text</think>actual response" with no opening <think> tag.
  // Treat everything before the first </think> as the think block.
  if (thinkParts.length === 0 && !hasUnclosedThink) {
    const closeIdx = raw.indexOf(CLOSE);
    if (closeIdx >= 0) {
      const thinkContent = raw.slice(0, closeIdx);
      const responseContent = raw.slice(closeIdx + CLOSE.length).trimStart();
      // Only treat as a think block if there's actual thinking content or a non-empty response
      if (thinkContent.trim() || responseContent) {
        // During live streaming: if </think> just appeared and the response is still empty,
        // isThinking stays false — thinkDone signals the ThinkBlock to render.
        return { thinkContent, isThinking: false, thinkDone: true, responseContent };
      }
    }
  }

  if (thinkParts.length === 0) {
    return { thinkContent: "", isThinking: false, thinkDone: false, responseContent: raw };
  }

  // All think blocks complete — strip them all from responseContent
  const responseContent = raw
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trimStart();

  return {
    thinkContent: thinkParts.join("\n\n"),
    isThinking: false,
    thinkDone: true,
    responseContent,
  };
}

// ── Tool call/result parsing ──────────────────────────────────────────────────

type ContentSegment =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; callId: string; toolName: string; serverName: string; argsJson: string }
  | { type: 'tool_result'; callId: string; content: string; isError: boolean }

const TOOL_CALL_RE = /<tool_call id="([^"]*)" name="([^"]*)" server="([^"]*)">([\s\S]*?)<\/tool_call>/g
const TOOL_RESULT_RE = /<tool_result id="([^"]*)" isError="([^"]*)">([\s\S]*?)<\/tool_result>/g

function parseToolSegments(raw: string): ContentSegment[] {
  // Combine both patterns and sort by index so we process in document order
  const markers: Array<{ index: number; end: number; segment: ContentSegment }> = []

  let m: RegExpExecArray | null
  TOOL_CALL_RE.lastIndex = 0
  while ((m = TOOL_CALL_RE.exec(raw)) !== null) {
    markers.push({
      index: m.index,
      end: m.index + m[0].length,
      segment: {
        type: 'tool_call',
        callId: m[1],
        toolName: m[2],
        serverName: m[3],
        argsJson: m[4].trim(),
      },
    })
  }

  TOOL_RESULT_RE.lastIndex = 0
  while ((m = TOOL_RESULT_RE.exec(raw)) !== null) {
    markers.push({
      index: m.index,
      end: m.index + m[0].length,
      segment: {
        type: 'tool_result',
        callId: m[1],
        content: m[3].trim(),
        isError: m[2] === 'true',
      },
    })
  }

  if (markers.length === 0) return [{ type: 'text', content: raw }]

  markers.sort((a, b) => a.index - b.index)

  const segments: ContentSegment[] = []
  let cursor = 0
  for (const { index, end, segment } of markers) {
    if (index > cursor) {
      const text = raw.slice(cursor, index).trim()
      if (text) segments.push({ type: 'text', content: text })
    }
    segments.push(segment)
    cursor = end
  }
  if (cursor < raw.length) {
    const text = raw.slice(cursor).trim()
    if (text) segments.push({ type: 'text', content: text })
  }
  return segments
}

/** Render a content string that may contain tool_call/tool_result markers.
 *  Pass `live` when rendering streaming content so pending tool cards show approval buttons. */
function ToolAwareContent({ content, live }: { content: string; live?: boolean }): JSX.Element {
  const segments = parseToolSegments(content)
  const toolResultCallIds = new Set(
    segments
      .filter((s): s is Extract<ContentSegment, { type: "tool_result" }> => s.type === "tool_result")
      .map((s) => s.callId),
  )
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'tool_call') {
          return (
            <ToolCallBlock
              key={`tc-${i}`}
              callId={seg.callId}
              toolName={seg.toolName}
              serverName={seg.serverName}
              argsJson={seg.argsJson}
              resolved={!live}
              toolFinished={toolResultCallIds.has(seg.callId)}
            />
          )
        }
        if (seg.type === 'tool_result') {
          return (
            <ToolResultBlock
              key={`tr-${i}`}
              toolCallId={seg.callId}
              content={seg.content}
              isError={seg.isError}
            />
          )
        }
        return <MarkdownContent key={`txt-${i}`} content={seg.content} />
      })}
    </>
  )
}

/** Plain collapsed preview text for thinking blocks (not markdown). */
function thinkPreviewLine(raw: string): string {
  let stripped = raw
    .replace(/<[^>]+>/g, "")
    .replace(/\*{1,2}|`{1,3}|#{1,6}\s?/g, "")
    .replace(/\s+/g, " ")
    .trim();
  stripped = stripped.replace(
    /^(?:\*\*\s*)?thinking\s*process\s*(?:\*\*)?\s*:\s*/i,
    "",
  );
  return stripped.trim();
}

/** One-line preview: fills left-to-right; when it would overflow, the line clears and new stream text continues from the left. */
function ThinkPreviewLine({
  text,
  className,
}: {
  text: string;
  className?: string;
}): JSX.Element {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef(text);
  textRef.current = text;

  // Start at the current end so remounts (e.g. after expand/collapse) don't replay stale accumulated text.
  const [lineStart, setLineStart] = useState(() => text.length);

  useEffect(() => {
    if (text.length < lineStart) setLineStart(0);
  }, [text, lineStart]);

  const visible = text.slice(lineStart);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    const flushIfNeeded = (): void => {
      const t = textRef.current;
      if (outer.clientWidth === 0) return;
      if (inner.scrollWidth <= outer.clientWidth) return;
      setLineStart(t.length);
    };

    flushIfNeeded();
    const ro = new ResizeObserver(flushIfNeeded);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [text, lineStart]);

  return (
    <div
      ref={outerRef}
      className={cn(
        "min-w-0 w-full overflow-hidden pl-6 text-left text-sm leading-snug",
        className,
      )}
    >
      <span
        ref={innerRef}
        className="inline-block whitespace-nowrap think-shimmer"
        title={text}
      >
        {visible}
      </span>
    </div>
  );
}

interface UserAttachments {
  images: Array<{ name: string; data: string }>;
  pdfGroups: Array<{ name: string; pages: string[] }>;
  documents: Array<{ name: string; content: string }>;
  text: string;
}

const PDF_PAGE_RE = /^(.+) — page (\d+)$/;

// Extracts <image> and <document> blocks prepended to user messages.
// Images named "file.pdf — page N" are grouped back into a single PDF entry.
function parseUserContent(raw: string): UserAttachments {
  const images: Array<{ name: string; data: string }> = [];
  const pdfGroups: Array<{ name: string; pages: string[] }> = [];
  const documents: Array<{ name: string; content: string }> = [];

  const imgPattern = /<image name="([^"]*)">\n([\s\S]*?)\n<\/image>/g;
  const docPattern = /<document name="([^"]*)">\n([\s\S]*?)\n<\/document>/g;
  let m: RegExpExecArray | null;

  const pdfOrder: string[] = [];
  const pdfMap = new Map<string, Array<{ page: number; data: string }>>();

  while ((m = imgPattern.exec(raw)) !== null) {
    const name = m[1]!;
    const data = m[2]!;
    const pdfMatch = PDF_PAGE_RE.exec(name);
    if (pdfMatch) {
      const pdfName = pdfMatch[1]!;
      const pageNum = parseInt(pdfMatch[2]!, 10);
      if (!pdfMap.has(pdfName)) { pdfMap.set(pdfName, []); pdfOrder.push(pdfName); }
      pdfMap.get(pdfName)!.push({ page: pageNum, data });
    } else {
      images.push({ name, data });
    }
  }

  for (const name of pdfOrder) {
    const pages = pdfMap.get(name)!
      .sort((a, b) => a.page - b.page)
      .map((p) => p.data);
    pdfGroups.push({ name, pages });
  }

  while ((m = docPattern.exec(raw)) !== null)
    documents.push({ name: m[1]!, content: m[2]! });

  const text = raw
    .replace(/<image name="[^"]*">\n[\s\S]*?\n<\/image>\n*/g, "")
    .replace(/<pdf-preview name="[^"]*">\n[\s\S]*?\n<\/pdf-preview>\n*/g, "")
    .replace(/<document name="[^"]*">\n[\s\S]*?\n<\/document>\n*/g, "")
    .trimStart();
  return { images, pdfGroups, documents, text };
}

/** `html.light` remaps zinc-* so muted grays read as light-on-light. Use neutral-* for readable copy (not remapped in index.css). */
function useChatLightMode(): boolean {
  return useThemeStore((s) => s.theme === "light");
}

// ── Shared action button ──────────────────────────────────────────────────────

function ActionBtn({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  danger?: boolean;
}): JSX.Element {
  const isLight = useChatLightMode();
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "flex items-center gap-1 px-1.5 py-1 rounded text-sm transition-colors",
        danger
          ? isLight
            ? "text-neutral-500 hover:text-red-600 hover:bg-red-500/10"
            : "text-zinc-600 hover:text-red-400 hover:bg-red-500/10"
          : isLight
            ? "text-neutral-500 hover:text-neutral-900 hover:bg-neutral-200/80"
            : "text-zinc-600 hover:text-zinc-300 hover:bg-zinc-700/50",
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
    </button>
  );
}

// ── Code block with copy button ───────────────────────────────────────────────

const CodeBlock = React.memo(function CodeBlock({
  language,
  code,
  isLight,
}: {
  language: string;
  code: string;
  isLight: boolean;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const handleCopy = (): void => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div
      className={cn(
        "mb-2.5 rounded-lg overflow-hidden border",
        isLight ? "border-neutral-300/90" : "border-zinc-700/50",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-between px-3 py-1.5",
          isLight ? "bg-neutral-200/90" : "bg-zinc-900",
        )}
      >
        <span
          className={cn(
            "text-xs font-code",
            isLight ? "text-neutral-700" : "text-zinc-500",
          )}
        >
          {language}
        </span>
        <button
          onClick={handleCopy}
          className={cn(
            "flex items-center gap-1 text-xs transition-colors",
            isLight
              ? "text-neutral-600 hover:text-neutral-900"
              : "text-zinc-500 hover:text-zinc-200",
          )}
        >
          {copied ? (
            <Check className="w-3 h-3 text-green-400" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <div className="code-block-container">
        <SyntaxHighlighter
          language={language}
          style={isLight ? lightModePrismStyle : nord}
          customStyle={{
            margin: 0,
            borderRadius: 0,
            fontSize: "1rem",
            padding: "0.75rem",
            ...(isLight
              ? {
                  border: "none",
                  background: LIGHT_CODE_SURFACE,
                }
              : undefined),
          }}
          customProps={{
            style: { fontSize: "1rem" },
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
});

// ── Markdown renderer ─────────────────────────────────────────────────────────

function MarkdownContent({ content }: { content: string }): JSX.Element {
  const isLight = useChatLightMode();
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p({ children }) {
          return (
            <p
              className={cn(
                "mb-2.5 last:mb-0 leading-relaxed",
                isLight && "text-neutral-800",
              )}
            >
              {children}
            </p>
          );
        },
        h1({ children }) {
          return (
            <h1
              className={cn(
                "text-xl font-bold mb-3 mt-5 first:mt-0",
                isLight ? "text-neutral-950" : "text-zinc-100",
              )}
            >
              {children}
            </h1>
          );
        },
        h2({ children }) {
          return (
            <h2
              className={cn(
                "text-lg font-bold mb-2 mt-4 first:mt-0",
                isLight ? "text-neutral-950" : "text-zinc-100",
              )}
            >
              {children}
            </h2>
          );
        },
        h3({ children }) {
          return (
            <h3
              className={cn(
                "text-base font-semibold mb-2 mt-3 first:mt-0",
                isLight ? "text-neutral-950" : "text-zinc-100",
              )}
            >
              {children}
            </h3>
          );
        },
        ul({ children }) {
          return (
            <ul className="list-disc list-outside pl-5 mb-2.5 space-y-0.5">
              {children}
            </ul>
          );
        },
        ol({ children }) {
          return (
            <ol className="list-decimal list-outside pl-5 mb-2.5 space-y-0.5">
              {children}
            </ol>
          );
        },
        li({ children }) {
          return <li className="leading-relaxed">{children}</li>;
        },
        blockquote({ children }) {
          return (
            <blockquote
              className={cn(
                "border-l-2 pl-3 italic mb-2.5",
                isLight
                  ? "border-neutral-400 text-neutral-700"
                  : "border-zinc-500 text-zinc-400",
              )}
            >
              {children}
            </blockquote>
          );
        },
        pre({ children }) {
          // SyntaxHighlighter renders its own container; just pass through.
          // For blocks without a detected language it renders a plain pre below.
          return <>{children}</>;
        },
        code({ children, className }) {
          const str = String(children ?? "").replace(/\n$/, "");
          const match = /language-(\w+)/.exec(className ?? "");
          if (match) {
            return (
              <CodeBlock
                language={match[1]}
                code={str}
                isLight={isLight}
              />
            );
          }
          // Fenced block without language tag
          if (str.includes("\n")) {
            return (
              <pre
                className={cn(
                  "code-block-container border rounded-lg p-3 overflow-x-auto font-code whitespace-pre mb-2.5",
                  isLight
                    ? "bg-neutral-900 border-neutral-600 text-neutral-100"
                    : "bg-zinc-950 border-zinc-700/50 text-zinc-200",
                )}
              >
                <code>{str}</code>
              </pre>
            );
          }
          // Inline code — light: grey chip like before, cyan text to match pp/tg selected accent
          return (
            <code
              className={cn(
                "rounded px-1.5 py-0.5 font-code",
                isLight
                  ? "bg-neutral-200/90 text-cyan-600"
                  : "bg-zinc-700/60 text-cyan-300",
              )}
            >
              {children}
            </code>
          );
        },
        a({ href, children }) {
          return (
            <a
              href={href}
              className={cn(
                "underline transition-colors",
                isLight
                  ? "text-cyan-700 decoration-cyan-700/35 hover:text-cyan-800"
                  : "text-cyan-400 decoration-cyan-400/40 hover:text-cyan-300",
              )}
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          );
        },
        strong({ children }) {
          return (
            <strong
              className={cn(
                "font-semibold",
                isLight ? "text-neutral-950" : "text-zinc-100",
              )}
            >
              {children}
            </strong>
          );
        },
        em({ children }) {
          return (
            <em
              className={cn(
                "italic",
                isLight ? "text-neutral-800" : "text-zinc-300",
              )}
            >
              {children}
            </em>
          );
        },
        hr() {
          return (
            <hr
              className={cn("my-4", isLight ? "border-neutral-300" : "border-zinc-700")}
            />
          );
        },
        table({ children }) {
          return (
            <div className="overflow-x-auto mb-2.5">
              <table className="border-collapse w-full text-sm">
                {children}
              </table>
            </div>
          );
        },
        th({ children }) {
          return (
            <th
              className={cn(
                "border px-3 py-1.5 text-left font-semibold",
                isLight
                  ? "bg-neutral-200 border-neutral-300 text-neutral-900"
                  : "bg-zinc-800 border-zinc-600 text-zinc-200",
              )}
            >
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td
              className={cn(
                "border px-3 py-1.5",
                isLight
                  ? "border-neutral-200 text-neutral-800"
                  : "border-zinc-700 text-zinc-300",
              )}
            >
              {children}
            </td>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

// ── ProcessingBubble ──────────────────────────────────────────────────────────
// Shown while waiting for the first token (prompt is being processed server-side).
// Deliberately neutral — no brain icon — so it appears for all model types.

function ProcessingBubble({ elapsedMs }: { elapsedMs: number }): JSX.Element {
  const isLight = useChatLightMode();
  const secs = Math.floor(elapsedMs / 1000);
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 text-sm py-0.5 select-none",
        isLight ? "text-neutral-600" : "text-zinc-500",
      )}
    >
      <div
        className={cn(
          "w-3.5 h-3.5 border-2 rounded-full animate-spin shrink-0",
          isLight
            ? "border-neutral-300 border-t-neutral-700"
            : "border-zinc-700 border-t-zinc-400",
        )}
      />
      <span>{secs > 0 ? `Processing · ${secs}s` : "Processing…"}</span>
    </div>
  );
}

// ── ThinkingBubble ────────────────────────────────────────────────────────────
// Shown only when <think> tokens are actively streaming — thinking models only.

function ThinkingBubble({
  elapsedMs,
  preview,
}: {
  elapsedMs: number;
  /** When set (collapsed), second line — one-line preview of streamed thought text. */
  preview?: string;
}): JSX.Element {
  const isLight = useChatLightMode();
  const secs = Math.floor(elapsedMs / 1000);
  return (
    <div className="flex flex-col gap-1 min-w-0 flex-1 text-left select-none">
      <div
        className={cn(
          "flex items-center gap-2 text-sm py-0.5",
          isLight ? "text-neutral-700" : "text-zinc-400",
        )}
      >
        <Brain className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        <span className="shrink-0">
          Thinking{secs > 0 ? ` · ${secs}s` : "…"}
        </span>
        <span className="flex items-center gap-0.5 shrink-0">
          <span
            className="w-1.5 h-1.5 rounded-full bg-cyan-400/80 animate-bounce"
            style={{ animationDelay: "0ms" }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full bg-cyan-400/80 animate-bounce"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full bg-cyan-400/80 animate-bounce"
            style={{ animationDelay: "300ms" }}
          />
        </span>
      </div>
      {preview ? <ThinkPreviewLine text={preview} /> : null}
    </div>
  );
}

// ── ThinkBlock ────────────────────────────────────────────────────────────────

function ThinkBlock({
  content,
  durationMs,
  defaultOpen = false,
  onOpenChange,
}: {
  content: string;
  durationMs?: number;
  defaultOpen?: boolean;
  /** Fires when expanded/collapsed changes (including initial mount). Used to hand off live thinking UI state. */
  onOpenChange?: (open: boolean) => void;
}): JSX.Element {
  const isLight = useChatLightMode();
  const [open, setOpen] = useState(defaultOpen);
  const secs = durationMs !== undefined ? Math.round(durationMs / 1000) : null;

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          "w-full flex items-center justify-between gap-2 text-sm transition-colors group text-left min-w-0",
          isLight
            ? "text-neutral-600 hover:text-neutral-900"
            : "text-zinc-500 hover:text-zinc-300",
        )}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Brain className="w-3 h-3 shrink-0 text-cyan-400/60 group-hover:text-cyan-400 transition-colors" />
          <span>
            {secs !== null && secs > 0 ? `Thought for ${secs}s` : "View thoughts"}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "w-3 h-3 shrink-0 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div
          className={cn(
            "mt-2 rounded-lg p-3 text-sm leading-relaxed max-h-64 overflow-y-auto border",
            isLight
              ? "border-cyan-200/60 bg-cyan-50/90 text-neutral-800"
              : "border-cyan-500/20 bg-cyan-950/10 text-zinc-400",
          )}
        >
          <MarkdownContent content={content.trim()} />
        </div>
      )}
    </div>
  );
}

/** Icon + short native tooltip (`title`) for assistant reply metrics. */
function MetricStat({
  icon: Icon,
  tooltip,
  children,
}: {
  icon: LucideIcon;
  tooltip: string;
  children: React.ReactNode;
}): JSX.Element {
  const isLight = useChatLightMode();
  return (
    <span
      title={tooltip}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1 py-0.5 -mx-0.5 cursor-default transition-colors font-code tabular-nums",
        isLight ? "hover:bg-neutral-200/75" : "hover:bg-white/[0.06]",
      )}
    >
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0 opacity-60",
          isLight ? "text-neutral-600" : "text-zinc-500",
        )}
        aria-hidden
      />
      {children}
    </span>
  );
}

// ── LiveStatsRow ──────────────────────────────────────────────────────────────
// Mirrors the static stats row on completed messages, updating in real time.

function LiveStatsRow(): JSX.Element | null {
  const isLight = useChatLightMode();
  const {
    livePhase,
    liveTokensPerSecond,
    liveTokenCount,
    liveGenElapsedMs,
    liveProcessingElapsedMs,
    liveContextTokens,
    contextSize,
  } = useChatStore();

  if (!livePhase) return null;

  const muted = isLight ? "text-neutral-600" : "text-zinc-500";
  const emphasis = isLight ? "text-neutral-800" : "text-zinc-300";

  return (
    <div className="flex flex-wrap items-center gap-3 pl-2">
      {livePhase === "processing" ? (
        liveProcessingElapsedMs !== null && (
          <MetricStat
            icon={Hourglass}
            tooltip="Prompt processing time"
          >
            <span className={cn("text-sm", muted)}>
              processing · {(liveProcessingElapsedMs / 1000).toFixed(1)}s
            </span>
          </MetricStat>
        )
      ) : (
        <>
          {liveTokensPerSecond !== null && (
            <MetricStat
              icon={Gauge}
              tooltip="Tokens per second"
            >
              <span className={cn("text-sm font-semibold", emphasis)}>
                {liveTokensPerSecond.toFixed(1)} t/s
              </span>
            </MetricStat>
          )}
          {liveTokenCount != null && liveTokenCount > 0 && (
            <MetricStat
              icon={Hash}
              tooltip="Response length"
            >
              <span className={cn("text-sm", muted)}>
                {liveTokenCount.toLocaleString()} tokens
              </span>
            </MetricStat>
          )}
          {liveGenElapsedMs != null && liveGenElapsedMs > 0 && (
            <MetricStat
              icon={Clock}
              tooltip="Generation time"
            >
              <span className={cn("text-sm", muted)}>
                {(liveGenElapsedMs / 1000).toFixed(1)}s
              </span>
            </MetricStat>
          )}
          {liveContextTokens != null && contextSize != null && (
            <MetricStat
              icon={Layers}
              tooltip="Context usage"
            >
              <span className={cn("text-sm", muted)}>
                {liveContextTokens.toLocaleString()}/
                {contextSize.toLocaleString()} ctx
              </span>
            </MetricStat>
          )}
        </>
      )}
    </div>
  );
}

// ── StreamingBubble ───────────────────────────────────────────────────────────

function StreamingBubble({
  content,
  thinkExpandedRef,
}: {
  content: string;
  thinkExpandedRef: React.MutableRefObject<boolean>;
}): JSX.Element {
  const isLight = useChatLightMode();
  const mountTime = useRef(Date.now());
  const thinkStartTime = useRef<number | null>(null);
  const thinkEndTime = useRef<number | null>(null);
  const parsed = parseContent(content);
  const isEmpty = content.length === 0;
  const [thinkOpen, setThinkOpen] = useState(false);
  const thinkPanelRef = useRef<HTMLDivElement>(null);

  // Live thinking header uses `thinkOpen`; after that, ThinkBlock owns expand state via onOpenChange.
  useEffect(() => {
    if (parsed.isThinking) {
      thinkExpandedRef.current = thinkOpen;
    }
  }, [parsed.isThinking, thinkOpen, thinkExpandedRef]);

  const onThinkBlockOpenChange = useCallback((open: boolean) => {
    thinkExpandedRef.current = open;
  }, [thinkExpandedRef]);

  // Record the first moment <think> appears (set during render — safe since refs don't cause re-renders)
  if (parsed.isThinking && thinkStartTime.current === null) {
    thinkStartTime.current = Date.now();
  }

  // Capture the moment </think> first appears
  if (thinkEndTime.current === null && parsed.thinkDone) {
    thinkEndTime.current = Date.now();
  }

  // Keep the timer ticking while waiting for the first token OR while thinking
  const [, tick] = useState(0);
  useEffect(() => {
    if (!isEmpty && !parsed.isThinking) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [isEmpty, parsed.isThinking]);

  // Auto-scroll the live thought panel to the bottom as text arrives
  useEffect(() => {
    if (thinkOpen && thinkPanelRef.current) {
      thinkPanelRef.current.scrollTop = thinkPanelRef.current.scrollHeight;
    }
  });

  // Processing timer: total time since stream started (includes PP wait)
  const processingElapsedMs = Date.now() - mountTime.current;

  // Thinking timer: time since <think> first appeared, so the counter resets
  // to 0 when thinking begins rather than carrying over the PP wait time.
  const thinkingElapsedMs = thinkStartTime.current
    ? Date.now() - thinkStartTime.current
    : processingElapsedMs;

  // Thinking duration for the collapsed ThinkBlock header ("Thought for Xs"):
  // use think-start → think-end, not mount → think-end.
  const thinkDurationMs = thinkStartTime.current && thinkEndTime.current
    ? thinkEndTime.current - thinkStartTime.current
    : thinkEndTime.current
      ? thinkEndTime.current - mountTime.current
      : processingElapsedMs;

  const cursor = (
    <span className="inline-block w-1.5 h-[1em] bg-cyan-400 ml-0.5 animate-pulse align-middle" />
  );

  // Waiting for first token — neutral processing animation (all model types)
  const streamBubble = cn(
    "rounded-lg px-4 py-3 text-base border",
    isLight
      ? "bg-neutral-100/95 border-neutral-200/90 text-neutral-900"
      : "bg-zinc-800/50 border-zinc-700/50 text-zinc-200",
  );
  const streamThinkShell = cn(
    "rounded-lg text-base overflow-hidden border",
    isLight
      ? "bg-neutral-100/95 border-cyan-300/40"
      : "bg-zinc-800/50 border-cyan-500/20",
  );

  if (isEmpty) {
    return (
      <div className="flex flex-col gap-1">
        <div className={streamBubble}>
          <ProcessingBubble elapsedMs={processingElapsedMs} />
        </div>
      </div>
    );
  }

  // Thinking in progress — cyan animation + collapsible live thought stream
  if (parsed.isThinking) {
    return (
      <div className="flex flex-col gap-1">
        <div className={streamThinkShell}>
          <button
            type="button"
            onClick={() => setThinkOpen((v) => !v)}
            aria-expanded={thinkOpen}
            className={cn(
              "w-full flex items-start justify-between gap-2 px-4 py-3 text-left transition-colors",
              isLight ? "hover:bg-neutral-200/60" : "hover:bg-zinc-700/25",
            )}
          >
            <ThinkingBubble
              elapsedMs={thinkingElapsedMs}
              preview={
                !thinkOpen
                  ? thinkPreviewLine(parsed.thinkContent) || undefined
                  : undefined
              }
            />
            <span
              className={cn(
                "flex items-center gap-1 shrink-0 text-sm transition-colors",
                isLight
                  ? "text-neutral-600 hover:text-neutral-900"
                  : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              {thinkOpen ? "Hide" : "Show"}
              <ChevronDown
                className={cn(
                  "w-3 h-3 transition-transform duration-200",
                  thinkOpen && "rotate-180",
                )}
              />
            </span>
          </button>
          {thinkOpen && (
            <div className="px-4 pb-3 pt-0">
              <div
                ref={thinkPanelRef}
                className={cn(
                  "border rounded-lg p-3 text-sm leading-relaxed max-h-64 overflow-y-auto",
                  isLight
                    ? "border-cyan-200/60 bg-cyan-50/90 text-neutral-800"
                    : "border-cyan-500/20 bg-cyan-950/10 text-zinc-400",
                )}
              >
                <MarkdownContent content={parsed.thinkContent} />
                {cursor}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Response streaming (thinking complete or no thinking)
  return (
    <div className="flex flex-col gap-1">
      <div className={streamBubble}>
        {parsed.thinkDone && (
          <ThinkBlock
            content={parsed.thinkContent}
            durationMs={thinkDurationMs}
            defaultOpen={thinkOpen}
            onOpenChange={onThinkBlockOpenChange}
          />
        )}
        {parsed.responseContent && (
          <ToolAwareContent content={parsed.responseContent} live />
        )}
        {cursor}
      </div>
    </div>
  );
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({
  message,
  defaultThinkOpen,
  isLastUser,
  isLastAssistant,
}: {
  message: Message;
  /** When the assistant message was just finalized from a stream, preserves expanded thinking */
  defaultThinkOpen?: boolean;
  isLastUser?: boolean;
  isLastAssistant?: boolean;
}): JSX.Element {
  const isUser = message.role === "user";
  const parsed = isUser ? null : parseContent(message.content);
  const userParsed = isUser ? parseUserContent(message.content) : null;
  const [lightbox, setLightbox] = useState<{
    src: string;
    name: string;
  } | null>(null);
  const [docPreview, setDocPreview] = useState<{
    name: string;
    content: string;
  } | null>(null);
  const [pdfPreview, setPdfPreview] = useState<{
    name: string;
    pages: string[];
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [copied, setCopied] = useState(false);
  const [statsMode, setStatsMode] = useState<"generation" | "processing">(
    "generation",
  );
  const userEditRef = useRef<HTMLDivElement>(null);
  const assistantEditRef = useRef<HTMLTextAreaElement>(null);
  const { deleteMessage, updateMessageContent, regenerateFrom } =
    useChatStore();
  const isLight = useChatLightMode();

  // When user-message editing starts, seed the contentEditable div and focus it
  useEffect(() => {
    if (!editing || !isUser || !userEditRef.current) return;
    const el = userEditRef.current;
    el.innerText = userParsed?.text ?? "";
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  // When assistant-message editing starts, focus without scrolling
  useEffect(() => {
    if (!editing || isUser || !assistantEditRef.current) return;
    assistantEditRef.current.focus({ preventScroll: true });
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const conversationId = message.conversationId;

  const hasAttachments =
    userParsed &&
    (userParsed.images.length > 0 || userParsed.pdfGroups.length > 0 || userParsed.documents.length > 0);
  const hasText = userParsed && (userParsed.text.length > 0 || !hasAttachments);

  // Text to copy for assistant messages: the response content (no think block)
  const assistantDisplayContent = parsed?.thinkDone
    ? parsed.responseContent
    : message.content;

  const handleCopy = (): void => {
    const text = isUser ? userParsed!.text || "" : assistantDisplayContent;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSaveEdit = async (): Promise<void> => {
    await updateMessageContent(message.id, conversationId, editContent);
    setEditing(false);
  };

  const handleSaveEditUser = async (): Promise<void> => {
    const newText = userEditRef.current?.innerText ?? userParsed?.text ?? "";
    const allBlocks: string[] = [];
    const imgRe = /<image name="[^"]*">\n[\s\S]*?\n<\/image>/g;
    const docRe = /<document name="[^"]*">\n[\s\S]*?\n<\/document>/g;
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(message.content)) !== null) allBlocks.push(m[0]);
    while ((m = docRe.exec(message.content)) !== null) allBlocks.push(m[0]);
    const prefix = allBlocks.length > 0 ? allBlocks.join("\n") + "\n\n" : "";
    await updateMessageContent(message.id, conversationId, prefix + newText);
    setEditing(false);
  };

  return (
    <div className={cn("flex flex-col gap-1 group/msg", isUser && "items-end")}>
      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          name={lightbox.name}
          onClose={() => setLightbox(null)}
        />
      )}
      {docPreview && (
        <DocumentPreviewModal
          name={docPreview.name}
          content={docPreview.content}
          onClose={() => setDocPreview(null)}
        />
      )}
      {pdfPreview && (
        <PdfPagesPreviewModal
          name={pdfPreview.name}
          pages={pdfPreview.pages}
          onClose={() => setPdfPreview(null)}
        />
      )}
      {isUser ? (
        <>
          <div className="flex flex-col items-end gap-1.5 max-w-[75%]">
            {/* Image thumbnails */}
            {(userParsed!.images.length > 0 || userParsed!.pdfGroups.length > 0) && (
              <div className="flex flex-wrap gap-2 justify-end">
                {userParsed!.images.map((img) => (
                  <button
                    key={img.name}
                    onClick={() =>
                      setLightbox({ src: img.data, name: img.name })
                    }
                    className="relative group shrink-0 rounded-lg overflow-hidden border border-zinc-600/60 hover:border-cyan-500/60 transition-colors"
                    title={img.name}
                  >
                    <img
                      src={img.data}
                      alt={img.name}
                      className="w-24 h-24 object-cover"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                  </button>
                ))}
                {userParsed!.pdfGroups.map((pdf) => (
                  <button
                    key={pdf.name}
                    onClick={() => setPdfPreview({ name: pdf.name, pages: pdf.pages })}
                    className="relative group shrink-0 rounded-lg overflow-hidden border border-zinc-600/60 hover:border-cyan-500/60 transition-colors"
                    title={`${pdf.name} (${pdf.pages.length} pages)`}
                  >
                    <img
                      src={pdf.pages[0]}
                      alt={pdf.name}
                      className="w-24 h-24 object-cover"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                    <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[9px] font-semibold text-white text-center py-0.5 leading-none">
                      {pdf.pages.length}p
                    </span>
                  </button>
                ))}
              </div>
            )}
            {/* Document file chips — match ChatInput attachment styling */}
            {userParsed!.documents.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-end">
                {userParsed!.documents.map((doc, idx) => {
                  const fileTypeInfo = getFileTypeInfo(doc.name);
                  return (
                    <FileChipHoverTooltip
                      key={`${doc.name}-${idx}`}
                      fileName={doc.name}
                      chipClassName={fileTypeInfo.chip}
                      className="w-32"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setDocPreview({ name: doc.name, content: doc.content })
                        }
                        className={cn(
                          "flex h-10 w-full shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-sm text-zinc-300 transition-colors",
                          fileTypeInfo.chip,
                          "hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/35",
                        )}
                        aria-label={`Preview ${doc.name}`}
                      >
                        {fileTypeInfo.icon ? (
                          <Icon
                            icon={fileTypeInfo.icon}
                            width={20}
                            height={20}
                            color={fileTypeInfo.color}
                            className="shrink-0 pointer-events-none"
                            aria-hidden
                          />
                        ) : (
                          <FileText
                            className="pointer-events-none h-3 w-3 shrink-0 text-zinc-400"
                            aria-hidden
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate">{doc.name}</span>
                      </button>
                    </FileChipHoverTooltip>
                  );
                })}
              </div>
            )}
            {/* Typed text bubble — editable inline when editing */}
            {(editing || hasText) && (
              <div
                className={cn(
                  "ml-auto max-w-full rounded-[1.25rem] rounded-br-md border border-cyan-500/30 bg-cyan-600/20",
                  "px-4 py-3 text-base text-zinc-100 leading-relaxed",
                  editing
                    ? "w-full min-w-[min(100%,22rem)]"
                    : "w-fit break-words",
                )}
              >
                {editing ? (
                  <>
                    {/* contentEditable keeps exact bubble shape; seeded via useEffect */}
                    <div
                      ref={userEditRef}
                      contentEditable
                      suppressContentEditableWarning
                      className="whitespace-pre-wrap outline-none min-h-[1em]"
                    />
                    <div className="flex gap-2 justify-end mt-2 pt-2 border-t border-cyan-500/20">
                      <button
                        onClick={() => setEditing(false)}
                        className="px-3 py-1 bg-zinc-700/60 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveEditUser}
                        className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white text-sm rounded-lg transition-colors"
                      >
                        Save
                      </button>
                    </div>
                  </>
                ) : (
                  <span className="whitespace-pre-wrap">
                    {userParsed!.text}
                  </span>
                )}
              </div>
            )}
          </div>
          {/* User action buttons — hidden while editing */}
          {!editing && (
            <div className="flex items-center gap-0.5">
              <ActionBtn
                icon={copied ? Check : Copy}
                label={copied ? "Copied" : "Copy"}
                onClick={handleCopy}
              />
              {isLastUser && (
                <>
                  <ActionBtn
                    icon={Pencil}
                    label="Edit"
                    onClick={() => {
                      setEditContent(userParsed!.text);
                      setEditing(true);
                    }}
                  />
                  <ActionBtn
                    icon={Trash2}
                    label="Delete"
                    onClick={() => deleteMessage(message.id, conversationId)}
                    danger
                  />
                </>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div
            className={cn(
              "rounded-lg px-4 py-3 text-base border",
              isLight
                ? "bg-neutral-100/95 border-neutral-200/90 text-neutral-900"
                : "bg-zinc-800/50 border-zinc-700/50 text-zinc-200",
            )}
          >
            {editing ? (
              <>
                <textarea
                  ref={assistantEditRef}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className={cn(
                    "w-full bg-transparent focus:outline-none resize-none font-code text-sm leading-relaxed",
                    isLight ? "text-neutral-900" : "text-zinc-200",
                  )}
                  rows={Math.max(4, editContent.split("\n").length)}
                />
                <div
                  className={cn(
                    "flex gap-2 mt-2 pt-2 border-t",
                    isLight ? "border-neutral-200" : "border-zinc-700/50",
                  )}
                >
                  <button
                    onClick={handleSaveEdit}
                    className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white text-sm rounded-lg transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setEditing(false);
                      setEditContent(message.content);
                    }}
                    className={cn(
                      "px-3 py-1 text-sm rounded-lg transition-colors",
                      isLight
                        ? "bg-neutral-200 hover:bg-neutral-300 text-neutral-800"
                        : "bg-zinc-700 hover:bg-zinc-600 text-zinc-300",
                    )}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                {parsed?.thinkDone && (
                  <ThinkBlock
                    content={parsed.thinkContent}
                    durationMs={message.thinkDurationMs}
                    defaultOpen={defaultThinkOpen ?? false}
                  />
                )}
                <ToolAwareContent content={assistantDisplayContent} />
              </>
            )}
          </div>
          {/* Stats row */}
          {(message.tokensPerSecond != null ||
            message.contextTokens != null ||
            message.tokenCount != null) &&
            (() => {
              const promptTokens =
                (message.contextTokens ?? 0) - (message.tokenCount ?? 0);
              const ppSecs = (message.promptProcessingMs ?? 0) / 1000;
              const ppTps = ppSecs > 0 ? promptTokens / ppSecs : null;
              return (
                <div className="flex flex-wrap items-center gap-3 pl-2">
                  {/* Mode toggle */}
                  <div className="flex items-center gap-0.5 mr-1">
                    <button
                      onClick={() => setStatsMode("processing")}
                      title="Prompt processing"
                      className={cn(
                        "px-1.5 py-0.5 rounded text-xs transition-colors",
                        statsMode === "processing"
                          ? isLight
                            ? "bg-cyan-200/90 text-cyan-900"
                            : "bg-cyan-600/40 text-cyan-300"
                          : isLight
                            ? "text-neutral-500 hover:text-neutral-800"
                            : "text-zinc-600 hover:text-zinc-400",
                      )}
                    >
                      pp
                    </button>
                    <button
                      onClick={() => setStatsMode("generation")}
                      title="Generation"
                      className={cn(
                        "px-1.5 py-0.5 rounded text-xs transition-colors",
                        statsMode === "generation"
                          ? isLight
                            ? "bg-cyan-200/90 text-cyan-900"
                            : "bg-cyan-600/40 text-cyan-300"
                          : isLight
                            ? "text-neutral-500 hover:text-neutral-800"
                            : "text-zinc-600 hover:text-zinc-400",
                      )}
                    >
                      tg
                    </button>
                  </div>

                  {statsMode === "generation" ? (
                    <>
                      {message.tokensPerSecond != null && (
                        <MetricStat
                          icon={Gauge}
                          tooltip="Tokens per second"
                        >
                          <span
                            className={cn(
                              "text-sm font-semibold",
                              isLight ? "text-neutral-800" : "text-zinc-300",
                            )}
                          >
                            {message.tokensPerSecond.toFixed(1)} t/s
                          </span>
                        </MetricStat>
                      )}
                      {message.tokenCount != null && (
                        <MetricStat
                          icon={Hash}
                          tooltip="Response length"
                        >
                          <span
                            className={cn(
                              "text-sm",
                              isLight ? "text-neutral-600" : "text-zinc-500",
                            )}
                          >
                            {message.tokenCount.toLocaleString()} tokens
                          </span>
                        </MetricStat>
                      )}
                      {message.tokenCount != null &&
                        message.tokensPerSecond != null &&
                        message.tokensPerSecond > 0 && (
                          <MetricStat
                            icon={Clock}
                            tooltip="Generation duration"
                          >
                            <span
                              className={cn(
                                "text-sm",
                                isLight ? "text-neutral-600" : "text-zinc-500",
                              )}
                            >
                              {(
                                message.tokenCount / message.tokensPerSecond
                              ).toFixed(1)}
                              s
                            </span>
                          </MetricStat>
                        )}
                      {message.contextTokens != null &&
                        message.contextSize != null && (
                          <MetricStat
                            icon={Layers}
                            tooltip="Context usage"
                          >
                            <span
                              className={cn(
                                "text-sm",
                                isLight ? "text-neutral-600" : "text-zinc-500",
                              )}
                            >
                              {message.contextTokens.toLocaleString()}/
                              {message.contextSize.toLocaleString()} ctx
                            </span>
                          </MetricStat>
                        )}
                    </>
                  ) : (
                    <>
                      {ppTps !== null && (
                        <MetricStat
                          icon={Gauge}
                          tooltip="Prompt processing tokens per second"
                        >
                          <span
                            className={cn(
                              "text-sm font-semibold",
                              isLight ? "text-neutral-800" : "text-zinc-300",
                            )}
                          >
                            {ppTps.toFixed(1)} t/s
                          </span>
                        </MetricStat>
                      )}
                      {promptTokens > 0 && (
                        <MetricStat
                          icon={Hash}
                          tooltip="Prompt length"
                        >
                          <span
                            className={cn(
                              "text-sm",
                              isLight ? "text-neutral-600" : "text-zinc-500",
                            )}
                          >
                            {promptTokens.toLocaleString()} tokens
                          </span>
                        </MetricStat>
                      )}
                      {message.promptProcessingMs != null ? (
                        <MetricStat
                          icon={Hourglass}
                          tooltip="Time to first token"
                        >
                          <span
                            className={cn(
                              "text-sm",
                              isLight ? "text-neutral-600" : "text-zinc-500",
                            )}
                          >
                            {ppSecs.toFixed(2)}s
                          </span>
                        </MetricStat>
                      ) : (
                        <MetricStat
                          icon={CircleAlert}
                          tooltip="No timing data"
                        >
                          <span
                            className={cn(
                              "text-sm",
                              isLight ? "text-neutral-600" : "text-zinc-600",
                            )}
                          >
                            no pp data
                          </span>
                        </MetricStat>
                      )}
                    </>
                  )}
                </div>
              );
            })()}
          {/* Assistant action buttons */}
          <div className="flex items-center gap-0.5 pl-2">
            <ActionBtn
              icon={copied ? Check : Copy}
              label={copied ? "Copied" : "Copy"}
              onClick={handleCopy}
            />
            {isLastAssistant && (
              <>
                <ActionBtn
                  icon={Pencil}
                  label="Edit"
                  onClick={() => {
                    setEditContent(message.content);
                    setEditing(true);
                  }}
                />
                <ActionBtn
                  icon={RefreshCw}
                  label="Regenerate"
                  onClick={() => regenerateFrom(message.id, conversationId)}
                />
                <ActionBtn
                  icon={Trash2}
                  label="Delete"
                  onClick={() => deleteMessage(message.id, conversationId)}
                  danger
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── MessageThread ─────────────────────────────────────────────────────────────

interface Props {
  conversationId: string;
}

export function MessageThread({ conversationId }: Props): JSX.Element {
  const isLight = useChatLightMode();
  const { messages, streaming, streamingContent, draftConv, draftMessages } =
    useChatStore();
  const msgs =
    draftConv?.id === conversationId && draftConv.isTemp
      ? draftMessages
      : (messages[conversationId] ?? []);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollLocked = useRef(false);
  /** Tracks expanded thinking during live stream; handed to the persisted message on stream end */
  const streamingThinkExpandedRef = useRef(false);
  /**
   * Survives past the single "stream just ended" render so remounts (Strict Mode, etc.)
   * still pass the same defaultThinkOpen to the assistant message that finished streaming.
   */
  const thinkHandoffRef = useRef<{ messageId: string; open: boolean } | null>(
    null,
  );
  const prevStreamingRef = useRef(streaming);
  const streamJustEnded =
    prevStreamingRef.current === true && streaming === false;
  if (streaming && !prevStreamingRef.current) {
    streamingThinkExpandedRef.current = false;
    thinkHandoffRef.current = null;
  }
  if (streamJustEnded && msgs.length > 0) {
    const last = msgs[msgs.length - 1];
    if (last.role === "assistant") {
      thinkHandoffRef.current = {
        messageId: last.id,
        open: streamingThinkExpandedRef.current,
      };
    }
  }
  prevStreamingRef.current = streaming;

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    // Lower threshold (30px) makes it easier to scroll up without being snapped back
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    scrollLocked.current = !atBottom;
  }, []);

  // Unlock when generation ends so the next message auto-scrolls correctly
  useEffect(() => {
    if (!streaming) {
      scrollLocked.current = false;
    }
  }, [streaming]);

  // Scroll to bottom on new completed messages (user sends or response saved)
  useEffect(() => {
    if (!scrollLocked.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [msgs.length]);

  // During streaming, keep bottom in view unless user has scrolled up.
  // useLayoutEffect runs after DOM updates but before paint, providing smoother tracking.
  useLayoutEffect(() => {
    if (streaming && !scrollLocked.current) {
      const el = containerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [streamingContent, streaming]);

  // Identify the last user message index to keep its edit/delete buttons visible
  const lastUserIdx = msgs.reduce(
    (acc, msg, i) => (msg.role === "user" ? i : acc),
    -1,
  );

  // Identify the last assistant message index to keep its edit/regen/delete buttons visible
  const lastAssistantIdx = msgs.reduce(
    (acc, msg, i) => (msg.role === "assistant" ? i : acc),
    -1,
  );

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto pt-0 pb-4"
      onScroll={handleScroll}
    >
      <div className="max-w-[min(70.4rem,92%)] mx-auto px-4 flex flex-col gap-4">
        {msgs.length === 0 && !streaming && (
          <div
            className={cn(
              "flex items-center justify-center py-20 text-sm",
              isLight ? "text-neutral-600" : "text-zinc-600",
            )}
          >
            Start a conversation
          </div>
        )}
        {msgs.map((msg, idx) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isLastUser={idx === lastUserIdx}
            isLastAssistant={idx === lastAssistantIdx}
            defaultThinkOpen={
              thinkHandoffRef.current?.messageId === msg.id
                ? thinkHandoffRef.current.open
                : undefined
            }
          />
        ))}
        {streaming && (
          <div className="flex flex-col gap-1">
            <StreamingBubble
              content={streamingContent}
              thinkExpandedRef={streamingThinkExpandedRef}
            />
            <LiveStatsRow />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
