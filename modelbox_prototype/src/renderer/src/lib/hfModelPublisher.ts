import type { Model } from "@shared/types";

/** Hub namespace segment — same as main `huggingfaceHub` PUBLISHER_RE. */
const HF_NAMESPACE_SEGMENT = /^[a-zA-Z0-9_.-]+$/;

function fileName(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

/** Core slug-matching logic shared by GGUF and vLLM model lookups. */
function matchBlobToSlug(blob: string): string | null {

  /* Kimi / Moonshot — before generic “mistral” substrings */
  if (/\b(kimi|moonshot)\b/.test(blob)) return "moonshotai";

  /* OpenAI gpt-oss & branded filenames */
  if (/\bgpt[-_]?oss\b/.test(blob) || /\bopenai[-_]/i.test(blob)) {
    return "openai";
  }

  /* Z.ai / Zhipu GLM (GLM-4+, Cog*, CodeGeeX); legacy Tsinghua ChatGLM */
  if (
    /\b(zhipu|zai-org|cogvlm|cogvideo|cogagent|codegeex|glm[-_]?[45]|glm4|glm5|glm[-_]?\d)/.test(
      blob,
    ) ||
    /\bglm\b/.test(blob)
  ) {
    return "zai-org";
  }
  if (/\b(thudm|chatglm)\b/.test(blob)) return "THUDM";

  /* ByteDance Seed (narrow — avoid generic “seed” in unrelated paths) */
  if (
    /\b(bytedance|seed[-_]?oss|seedoss|bytedance[-_]?seed|seed[-_]?\d+b)\b/.test(
      blob,
    )
  ) {
    return "ByteDance-Seed";
  }

  if (/\b(qwen|qwq|qwen2|qwen3|qwen[-_]?2|qwen[-_]?3)\b/.test(blob)) {
    return "Qwen";
  }
  if (/\bdeepseek\b/.test(blob)) return "deepseek-ai";

  /* MiniMax — Hub org slug is MiniMaxAI (not "minimax") */
  if (/\bminimax(ai)?\b/.test(blob)) return "MiniMaxAI";

  if (
    /\b(mistral|mixtral|ministral|pixtral|codestral|magistral|voxtral|votral|devstral|mistral-small|mistral-large)\b/.test(
      blob,
    )
  ) {
    return "mistralai";
  }
  if (/\b\w*gemma\b/.test(blob)) return "google";
  if (
    /\b(llama[-_]?[34]|llama[-_]?2|meta[-_]?llama|llama\.?\d|vicuna)\b/.test(
      blob,
    ) ||
    /\bllama[-_]?(?:3|2)\b/.test(blob)
  ) {
    return "meta-llama";
  }
  if (/\bphi[-_]?(?:3|4|mini|small|medium|large)\b/.test(blob)) {
    return "microsoft";
  }
  if (/\b(nemotron|nvidia|chatqa)\b/.test(blob)) return "nvidia";
  if (/\b(01-ai|yi[-_]|yi\.)\b/.test(blob)) return "01-ai";
  if (/\b(tinyllama|tiny[-_]?llama)\b/.test(blob)) return "TinyLlama";
  if (/\b(falcon|tiiuae)\b/.test(blob)) return "tiiuae";
  if (/\b(starcoder|bigcode)\b/.test(blob)) return "bigcode";
  if (/\b(nousresearch|hermes)\b/.test(blob)) return "NousResearch";
  if (/\bopenchat\b/.test(blob)) return "openchat";
  if (/\binternlm\b/.test(blob)) return "internlm";
  if (/\b(stable[-_]?lm|stabilityai)\b/.test(blob)) return "stabilityai";
  if (/\b(bge|bert|baai)\b/.test(blob)) return "BAAI";
  if (/\bnomic\b/.test(blob)) return "nomic-ai";

  return null;
}

/**
 * Hugging Face’s OpenAI avatar is a dark mark on a transparent PNG — render on a solid
 * light circle so it stays visible on dark UI chrome.
 */
export function publisherNeedsWhiteAvatarBackground(slug: string): boolean {
  return slug.toLowerCase() === "openai";
}

/**
 * Map a local GGUF model (name + paths) to a Hugging Face user/org slug for
 * `/api/.../avatar` — uses architecture/family in filenames so repacks (e.g.
 * Unsloth) still resolve to Qwen, Meta, etc.
 */
export function guessHfPublisherSlugFromModel(
  model: Model | undefined,
): string | null {
  if (!model) return null;
  const blob =
    `${model.name}\n${fileName(model.ggufPath)}\n${model.modelDir}`.toLowerCase();
  return matchBlobToSlug(blob);
}

/**
 * Same heuristic as `guessHfPublisherSlugFromModel` but for arbitrary text
 * (e.g. a vLLM model display name + path).
 */
export function guessHfPublisherSlugFromText(text: string): string | null {
  return matchBlobToSlug(text.toLowerCase());
}

/**
 * Path of `modelDir` relative to `root`, both normalized with `/` and trailing slashes removed.
 * Returns `""` when `modelDir` equals the root, `null` when not under `root`.
 */
function relativePathUnderRoot(modelDir: string, root: string): string | null {
  const md = modelDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const rt = root.replace(/\\/g, "/").replace(/\/+$/, "");
  if (md.toLowerCase() === rt.toLowerCase()) return "";
  if (md.length < rt.length + 2) return null;
  if (md.slice(0, rt.length).toLowerCase() !== rt.toLowerCase()) return null;
  if (md[rt.length] !== "/") return null;
  return md.slice(rt.length + 1);
}

function uniqueTrimmedRoots(dirs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of dirs) {
    const t = d.trim();
    if (!t) continue;
    const key = t.replace(/[/\\]+$/g, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Basename of GGUF path without `.gguf` (case-insensitive extension). */
function ggufFileStem(ggufPath: string): string {
  const norm = ggufPath.replace(/\\/g, "/");
  const base = norm.slice(norm.lastIndexOf("/") + 1);
  return base.replace(/\.gguf$/i, "");
}

/**
 * First folder under a configured models root (HF-style `provider/...` layout), e.g.
 * `modelsRoot/unsloth/file.gguf` → `unsloth`. Used for Hub avatar + label.
 * Returns `null` when the GGUF sits directly under a root, paths do not match settings,
 * or the provider folder is redundant: same as the GGUF filename stem, or the same as
 * `model.name` (card title — often the folder name when the GGUF is e.g. `model.gguf`).
 */
export function getHfProviderFolderSlugFromModel(
  model: Model,
  modelsDirs: string[],
): string | null {
  const roots = uniqueTrimmedRoots(modelsDirs);
  if (roots.length === 0) return null;

  const stem = ggufFileStem(model.ggufPath);
  const title = model.name.trim();
  const titleKey = title.length > 0 ? title.toLowerCase() : "";

  for (const root of roots) {
    const rel = relativePathUnderRoot(model.modelDir, root);
    if (rel === null) continue;
    if (rel === "") return null;
    const first = rel.split("/")[0] ?? "";
    if (!first || !HF_NAMESPACE_SEGMENT.test(first)) return null;
    const firstKey = first.toLowerCase();
    if (stem.length > 0 && firstKey === stem.toLowerCase()) {
      return null;
    }
    if (titleKey.length > 0 && firstKey === titleKey) {
      return null;
    }
    return first;
  }
  return null;
}

/**
 * Extract the provider folder from a model directory path.
 * The provider is the first folder segment under the models root directory.
 */
export function getProviderFromModelDir(
  modelDir: string,
  modelsDirs: string[],
): string | null {
  const roots = uniqueTrimmedRoots(modelsDirs);
  if (roots.length === 0) return null;

  for (const root of roots) {
    const rel = relativePathUnderRoot(modelDir, root);
    if (rel === null) continue;
    if (rel === "") return null;
    const first = rel.split("/")[0] ?? "";
    if (!first || !HF_NAMESPACE_SEGMENT.test(first)) return null;
    return first;
  }
  return null;
}
