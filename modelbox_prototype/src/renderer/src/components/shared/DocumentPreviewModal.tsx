import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Copy, Check } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { nord } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  LIGHT_CODE_SURFACE,
  lightModePrismStyle,
} from "../../lib/lightCodeThemes";
import { useThemeStore } from "../../store/themeStore";
import { cn } from "../../lib/utils";

export interface DocumentPreviewHeaderLead {
  /** Main label (e.g. model alias or model name). */
  primary: string;
  /** Optional second part (e.g. profile name). */
  secondary?: string;
}

interface Props {
  name: string;
  content: string;
  onClose: () => void;
  size?: 'default' | 'lg';
  subtitle?: string;
  headerLead?: DocumentPreviewHeaderLead;
  /** When true (live logs), pause auto-scroll while the user scrolls up and resume at the bottom. */
  liveScroll?: boolean;
}

/** Prism language ids supported by react-syntax-highlighter / refractor */
const EXT_TO_PRISM: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  py: "python",
  pyw: "python",
  rb: "ruby",
  php: "php",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  go: "go",
  rs: "rust",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  r: "r",
  jl: "julia",
  lua: "lua",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  ps1: "powershell",
  bat: "batch",
  cmd: "batch",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  vue: "markup",
  svelte: "markup",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  env: "properties",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  dockerfile: "docker",
  perl: "perl",
  pl: "perl",
  pm: "perl",
  tex: "latex",
  lisp: "lisp",
  clj: "clojure",
  hs: "haskell",
  elm: "elm",
  erl: "erlang",
  ex: "elixir",
  exs: "elixir",
  fs: "fsharp",
  fsx: "fsharp",
  dart: "dart",
  sol: "solidity",
  vim: "vim",
  ps: "powershell",
  log: "log",
  diff: "diff",
  patch: "diff",
  csv: "csv",
  txt: "plaintext",
};

function prismLanguageFromFilename(filename: string): string {
  const lower = filename.trim().toLowerCase();
  if (lower.endsWith("dockerfile") || lower === "dockerfile") return "docker";
  if (lower === "docker-compose.yml" || lower === "docker-compose.yaml")
    return "yaml";
  if (lower === ".gitignore" || lower.endsWith(".gitignore")) return "ignore";
  if (!lower.includes(".")) return "plaintext";
  const ext = lower.includes(".")
    ? (lower.split(".").pop() ?? "")
    : "";
  return EXT_TO_PRISM[ext] ?? "plaintext";
}

function grammarSubtitle(lang: string): string {
  if (lang === "plaintext") return "Plain text";
  return lang.replace(/-/g, " ");
}

export function DocumentPreviewModal({
  name,
  content,
  onClose,
  size = "default",
  subtitle: subtitleOverride,
  headerLead,
  liveScroll = false,
}: Props): JSX.Element {
  const isLight = useThemeStore((s) => s.theme === "light");
  const [copied, setCopied] = useState(false);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const language = useMemo(() => prismLanguageFromFilename(name), [name]);
  const useSyntaxHighlight = language !== "plaintext";
  const subtitle =
    subtitleOverride ?? grammarSubtitle(language);

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  /** Fullscreen log: start at bottom (tail); user can scroll up. Re-run after layout / Prism paint. */
  useLayoutEffect(() => {
    if (size !== "lg") return;
    const el = bodyScrollRef.current;
    if (!el) return;
    // When liveScroll is on, only auto-scroll if the user is at the bottom
    if (liveScroll && !isAtBottomRef.current) return;
    const toEnd = (): void => {
      el.scrollTop = el.scrollHeight;
    };
    toEnd();
    const t0 = requestAnimationFrame(() => {
      toEnd();
      requestAnimationFrame(toEnd);
    });
    const t1 = window.setTimeout(toEnd, 50);
    const t2 = window.setTimeout(toEnd, 200);
    return () => {
      cancelAnimationFrame(t0);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [size, content, name, liveScroll]);

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={cn(
          "flex w-full flex-col overflow-hidden rounded-2xl border",
          isLight
            ? size === "lg"
              ? "max-h-[min(92vh,900px)] max-w-5xl border-neutral-200 bg-white shadow-lg shadow-black/10"
              : "max-h-[min(85vh,720px)] max-w-3xl border-neutral-200 bg-white shadow-xl shadow-black/10 ring-1 ring-inset ring-neutral-200/60"
            : /* lg: one flat bg so the border reads the same on header vs sides (no darker body band) */
              size === "lg"
              ? "max-h-[min(92vh,900px)] max-w-5xl border-zinc-700/60 bg-zinc-950 shadow-none"
              : "max-h-[min(85vh,720px)] max-w-3xl border-zinc-700/60 bg-zinc-900/95 shadow-2xl shadow-black/50 ring-1 ring-inset ring-white/[0.06]",
        )}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="doc-preview-title"
      >
        <div
          className={cn(
            "flex shrink-0 items-center gap-3 px-4 py-3",
            size === "default" &&
              (isLight ? "border-b border-neutral-200" : "border-b border-white/[0.06]"),
          )}
        >
          <div className="min-w-0 flex-1">
            {headerLead ? (
              <div className="mb-1.5 min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span
                    className={cn(
                      "max-w-full truncate text-[15px] font-semibold tracking-tight text-transparent bg-gradient-to-r bg-clip-text",
                      isLight
                        ? "from-cyan-700 via-sky-700 to-teal-700"
                        : "from-cyan-300 via-sky-300 to-teal-400",
                    )}
                    title={headerLead.primary}
                  >
                    {headerLead.primary}
                  </span>
                  {headerLead.secondary ? (
                    <span
                      className={cn(
                        "text-xs font-medium",
                        isLight ? "text-violet-700/90" : "text-violet-300/90",
                      )}
                      title={headerLead.secondary}
                    >
                      · {headerLead.secondary}
                    </span>
                  ) : null}
                </p>
              </div>
            ) : null}
            <h2
              id="doc-preview-title"
              className={cn(
                "truncate text-sm font-medium",
                isLight ? "text-neutral-900" : "text-zinc-100",
              )}
              title={name}
            >
              {name}
            </h2>
            <p
              className={cn(
                "mt-0.5 text-[11px] font-medium uppercase tracking-wide",
                isLight ? "text-neutral-500" : "text-zinc-500",
              )}
            >
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
              isLight
                ? "border-neutral-300 bg-neutral-100 text-neutral-700 hover:bg-neutral-200 hover:text-neutral-900"
                : "border-zinc-700/60 bg-zinc-800/80 text-zinc-400 hover:bg-zinc-700/80 hover:text-zinc-200",
            )}
            title="Copy contents"
          >
            {copied ? (
              <Check
                className={cn(
                  "h-3.5 w-3.5",
                  isLight ? "text-emerald-600" : "text-emerald-400",
                )}
              />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "shrink-0 rounded-lg border p-1.5 transition-colors",
              isLight
                ? "border-neutral-300 bg-neutral-100 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900"
                : "border-zinc-700/60 bg-zinc-800/80 text-zinc-400 hover:bg-zinc-700/80 hover:text-zinc-100",
            )}
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div
          ref={bodyScrollRef}
          onScroll={() => {
            if (!liveScroll) return;
            const el = bodyScrollRef.current;
            if (!el) return;
            isAtBottomRef.current =
              el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
          }}
          className={cn(
            "min-h-0 flex-1 overflow-auto p-3",
            size === "lg"
              ? "bg-inherit"
              : isLight
                ? "bg-neutral-50/90"
                : "bg-zinc-950/40",
          )}
        >
          <div
            className={cn(
              "code-block-container overflow-hidden rounded-lg",
              size === "lg"
                ? "border-0 ring-0"
                : isLight
                  ? "border border-neutral-200 ring-1 ring-inset ring-black/[0.04]"
                  : "border border-zinc-700/40 ring-1 ring-inset ring-white/[0.04]",
            )}
          >
            {useSyntaxHighlight ? (
              <SyntaxHighlighter
                language={language}
                style={isLight ? lightModePrismStyle : nord}
                showLineNumbers={content.split("\n").length > 1}
                wrapLongLines
                customStyle={{
                  margin: 0,
                  borderRadius: "0.375rem",
                  fontSize: "13px",
                  lineHeight: 1.55,
                  padding: "0.875rem 1rem",
                  background: isLight ? LIGHT_CODE_SURFACE : "#2E3440",
                  ...(isLight ? { border: "none" } : undefined),
                }}
                lineNumberStyle={{
                  minWidth: "2.25rem",
                  paddingRight: "1em",
                  color: isLight ? "#bdbdbd" : "#4C566A",
                  userSelect: "none",
                }}
              >
                {content}
              </SyntaxHighlighter>
            ) : (
              <pre
                className={cn(
                  "whitespace-pre-wrap break-words rounded-md px-4 py-3 font-mono text-[13px] leading-relaxed",
                  isLight
                    ? size === "lg"
                      ? "bg-transparent text-neutral-800"
                      : "border border-neutral-200 text-neutral-800"
                    : size === "lg"
                      ? "bg-transparent text-zinc-300"
                      : "bg-zinc-950 text-zinc-300",
                )}
                style={
                  isLight && size !== "lg"
                    ? { backgroundColor: LIGHT_CODE_SURFACE }
                    : undefined
                }
              >
                {content}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
