import type { CSSProperties, ReactNode } from "react";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { nord } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  LIGHT_CODE_SURFACE,
  lightModePrismStyle,
} from "../../lib/lightCodeThemes";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { useThemeStore } from "../../store/themeStore";
import { cn } from "../../lib/utils";

/** Dark: Nord polar night. Light: Solarized Light on white. */
const CODE_BLOCK_SURFACE_DARK = "#2E3440";

/** Monospace size inside fenced blocks — between the old ~1rem and the oversized 1.5rem. */
const CODE_BLOCK_FONT_REM = "1.25rem";

/** Prism token styles often omit font size; merge so highlighted spans match the code element. */
function withReadmeCodeFontSize(
  prismStyle: Record<string, CSSProperties>,
  fontRem: string,
): Record<string, CSSProperties> {
  const out: Record<string, CSSProperties> = {};
  for (const key of Object.keys(prismStyle)) {
    const rule = prismStyle[key];
    if (rule && typeof rule === "object" && !Array.isArray(rule)) {
      out[key] = { ...rule, fontSize: fontRem };
    } else {
      out[key] = rule;
    }
  }
  return out;
}

function ReadmeCodeBlock({
  code,
  language,
}: {
  code: string;
  language: string;
}): JSX.Element {
  const isLight = useThemeStore((s) => s.theme === "light");
  const surface = isLight ? LIGHT_CODE_SURFACE : CODE_BLOCK_SURFACE_DARK;
  const readmePrismStyle = useMemo(
    () =>
      withReadmeCodeFontSize(
        (isLight ? lightModePrismStyle : nord) as Record<
          string,
          CSSProperties
        >,
        CODE_BLOCK_FONT_REM,
      ),
    [isLight],
  );
  const lang =
    language && /^[\w+-]+$/.test(language) ? language.toLowerCase() : "plaintext";
  return (
    <div
      className={cn(
        "mb-2.5 overflow-hidden rounded-lg border shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]",
        isLight ? "border-neutral-300/90" : "border-zinc-600/55",
      )}
      style={{ backgroundColor: surface }}
    >
      <SyntaxHighlighter
        language={lang}
        style={readmePrismStyle}
        PreTag="div"
        codeTagProps={{
          style: {
            fontSize: CODE_BLOCK_FONT_REM,
            lineHeight: 1.65,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          },
        }}
        customStyle={{
          margin: 0,
          padding: "0.75rem 1rem",
          fontSize: CODE_BLOCK_FONT_REM,
          lineHeight: 1.65,
          background: surface,
          borderRadius: 0,
          ...(isLight ? { border: "none" } : undefined),
        }}
      >
        {code.trimEnd()}
      </SyntaxHighlighter>
    </div>
  );
}

function ReadmeInlineCode({ children }: { children: ReactNode }): JSX.Element {
  const isLight = useThemeStore((s) => s.theme === "light");
  return (
    <code
      className={cn(
        "rounded border font-code text-lg font-normal leading-snug px-1.5 py-0.5",
        isLight
          ? "border-neutral-300/90 bg-neutral-200/90 text-cyan-600"
          : "border-zinc-600/55 bg-zinc-700/60 text-cyan-300",
      )}
    >
      {children}
    </code>
  );
}

/** Hub READMEs often mix Markdown with raw HTML; rehype-raw parses those blocks. */
export function HfReadmeMarkdown({ content }: { content: string }): JSX.Element {
  return (
    <div className="text-lg leading-relaxed text-zinc-300">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
        div({ children, style, className }) {
          return (
            <div
              className={cn("my-1 min-w-0 text-lg", className)}
              style={style as CSSProperties}
            >
              {children}
            </div>
          );
        },
        span({ children, style, className }) {
          return (
            <span
              className={cn("text-lg", className)}
              style={style as CSSProperties}
            >
              {children}
            </span>
          );
        },
        p({ children, style, className }) {
          return (
            <p
              className={cn(
                "mb-2.5 last:mb-0 leading-relaxed text-lg text-zinc-300",
                className,
              )}
              style={style as CSSProperties}
            >
              {children}
            </p>
          );
        },
        h1({ children }) {
          return (
            <h1 className="text-2xl font-bold mb-2 mt-4 first:mt-0 text-zinc-100">
              {children}
            </h1>
          );
        },
        h2({ children }) {
          return (
            <h2 className="text-xl font-bold mb-2 mt-3 first:mt-0 text-zinc-100">
              {children}
            </h2>
          );
        },
        h3({ children }) {
          return (
            <h3 className="text-lg font-semibold mb-1.5 mt-2.5 first:mt-0 text-zinc-100">
              {children}
            </h3>
          );
        },
        ul({ children, style, className }) {
          return (
            <ul
              className={cn(
                "list-disc list-outside pl-5 mb-2.5 space-y-0.5 text-lg text-zinc-300",
                className,
              )}
              style={style as CSSProperties}
            >
              {children}
            </ul>
          );
        },
        ol({ children }) {
          return (
            <ol className="list-decimal list-outside pl-5 mb-2.5 space-y-0.5 text-lg text-zinc-300">
              {children}
            </ol>
          );
        },
        li({ children }) {
          return <li className="leading-relaxed">{children}</li>;
        },
        blockquote({ children }) {
          return (
            <blockquote className="border-l-2 border-zinc-600 pl-3 italic text-zinc-400 mb-2.5 text-lg">
              {children}
            </blockquote>
          );
        },
        /** Markdown wraps fenced blocks in `<pre><code class="language-…">` — unwrap so we don’t nest `<pre>`. */
        pre({ children }) {
          return <>{children}</>;
        },
        code({ children, className }) {
          const str = String(children ?? "").replace(/\n$/, "");
          const match = /language-([\w+-]+)/.exec(className ?? "");
          const isBlock =
            str.includes("\n") || /language-/.test(className ?? "");
          if (isBlock) {
            const lang = match?.[1] ?? "plaintext";
            return <ReadmeCodeBlock code={str} language={lang} />;
          }
          return <ReadmeInlineCode>{children}</ReadmeInlineCode>;
        },
        a({ href, children }) {
          return (
            <a
              href={href}
              className="text-cyan-400 underline decoration-cyan-400/40 hover:text-cyan-300 transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          );
        },
        strong({ children }) {
          return (
            <strong className="font-semibold text-zinc-100">{children}</strong>
          );
        },
        em({ children }) {
          return <em className="italic text-zinc-400">{children}</em>;
        },
        hr() {
          return <hr className="border-zinc-700 my-4" />;
        },
        br() {
          return <br />;
        },
        table({ children }) {
          return (
            <div className="overflow-x-auto mb-2.5">
              <table className="border-collapse w-full text-base">{children}</table>
            </div>
          );
        },
        th({ children }) {
          return (
            <th className="bg-zinc-800 border border-zinc-600 px-2.5 py-2 text-left text-base font-semibold text-zinc-200">
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td className="border border-zinc-700 px-2.5 py-2 text-base text-zinc-300">
              {children}
            </td>
          );
        },
        img({ src, alt, width, height, style, className }) {
          const w =
            width === undefined || width === null
              ? undefined
              : typeof width === "number"
                ? width
                : Number.parseInt(String(width), 10);
          const h =
            height === undefined || height === null
              ? undefined
              : typeof height === "number"
                ? height
                : Number.parseInt(String(height), 10);
          return (
            <img
              src={src}
              alt={alt ?? ""}
              width={Number.isFinite(w) ? w : undefined}
              height={Number.isFinite(h) ? h : undefined}
              style={style as CSSProperties}
              className={cn(
                "max-w-full h-auto rounded-lg border border-zinc-700/50 my-2",
                className,
              )}
              loading="lazy"
            />
          );
        },
      }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
