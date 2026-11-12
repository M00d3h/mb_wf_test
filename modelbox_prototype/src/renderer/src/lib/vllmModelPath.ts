/**
 * Utilities for parsing HuggingFace hub cache folder names from vLLM model paths.
 * Hub cache uses the layout: models--<namespace>--<modelname>/snapshots/<hash>/
 */

export interface HfHubSegment {
  /** HF org/user slug, e.g. "cyankiwi", "Qwen", "deepseek-ai" */
  namespace: string;
  /** Model repo name, e.g. "Qwen3.5-27B-AWQ-4bit" */
  modelName: string;
}

/**
 * Split a HF hub cache folder name (e.g. `models--cyankiwi--Qwen3.5-27B-AWQ-4bit`)
 * into namespace + modelName. Returns null for non-hub folder names.
 * Splits on the FIRST `--` after the `models--` prefix, so org slugs with single
 * hyphens (e.g. `deepseek-ai`) are handled correctly.
 */
export function parseHfHubFolderName(folderName: string): HfHubSegment | null {
  if (!folderName.startsWith("models--")) return null;
  const rest = folderName.slice("models--".length);
  const sepIdx = rest.indexOf("--");
  if (sepIdx === -1) return null;
  const namespace = rest.slice(0, sepIdx);
  const modelName = rest.slice(sepIdx + 2);
  if (!namespace || !modelName) return null;
  return { namespace, modelName };
}

/**
 * Walk each path segment looking for a `models--namespace--modelname` folder.
 * Works for both UNC (`\\wsl$\…`) and posix paths.
 */
export function parseHfHubSegmentFromPath(
  modelPath: string,
): HfHubSegment | null {
  const normalized = modelPath.replace(/\\/g, "/");
  for (const seg of normalized.split("/")) {
    const parsed = parseHfHubFolderName(seg);
    if (parsed) return parsed;
  }
  return null;
}

/**
 * Resolve HF hub segment for display. Checks the path first (hub cache layout),
 * then falls back to splitting displayName on `/` (HF-downloaded models where
 * config.json _name_or_path sets displayName to "namespace/modelName").
 */
export function resolveHfHubSegment(
  modelPath: string,
  displayName: string,
): HfHubSegment | null {
  const fromPath = parseHfHubSegmentFromPath(modelPath);
  if (fromPath) return fromPath;
  const slash = displayName.indexOf("/");
  if (slash > 0 && slash < displayName.length - 1) {
    return {
      namespace: displayName.slice(0, slash),
      modelName: displayName.slice(slash + 1),
    };
  }
  return null;
}

/** Extract quant descriptor from a model name string (AWQ, GPTQ, INT4, BF16, etc.). */
export function extractVllmQuantLabel(name: string): string | null {
  const u = name.toUpperCase();
  if (/\bNVFP4\b/.test(u)) return "NVFP4";
  if (/\bMXFP4\b/.test(u)) return "MXFP4";
  if (/\bAWQ\b/.test(u)) return "AWQ";
  if (/\bGPTQ\b/.test(u)) return "GPTQ";
  // FP8: allow suffix like fp8_e4m3fn, fp8-dynamic (word boundary only on left)
  if (/\bFP8(?:\b|[-_])/.test(u)) return "FP8";
  if (/\bINT8\b/.test(u)) return "INT8";
  if (/\bINT4\b/.test(u)) return "INT4";
  if (/\bAUTOROUND\b/.test(u)) return "AutoRound";
  if (/\bBNB[-_]?4BIT\b/.test(u)) return "BNB-4bit";
  if (/\bBNB[-_]?8BIT\b/.test(u)) return "BNB-8bit";
  if (/\b4[-_]?BIT\b/.test(u)) return "4bit";
  if (/\b8[-_]?BIT\b/.test(u)) return "8bit";
  if (/\bBFLOAT16\b|\bBF16\b/.test(u)) return "BF16";
  if (/\bFLOAT16\b|\bFP16\b/.test(u)) return "FP16";
  if (/\bFLOAT32\b|\bFP32\b/.test(u)) return "FP32";
  return null;
}

/**
 * Map a raw `torch_dtype` / `quant_type` string (from config.json) to a display label.
 * Used as a fallback when the model name contains no quant hint.
 */
export function dtypeToLabel(rawDtype: string | null | undefined): string | null {
  if (!rawDtype) return null;
  const d = rawDtype.toLowerCase().trim();
  if (d === "bfloat16" || d === "bf16") return "BF16";
  if (d === "float16" || d === "fp16" || d === "half") return "FP16";
  if (d === "float32" || d === "fp32" || d === "float") return "FP32";
  if (d.startsWith("float8") || d === "fp8") return "FP8";
  if (d === "int8") return "INT8";
  if (d === "int4") return "INT4";
  if (d.includes("awq")) return "AWQ";
  if (d.includes("gptq")) return "GPTQ";
  if (d === "nvfp4" || d === "fp4") return "NVFP4";
  if (d === "mxfp4") return "MXFP4";
  return null;
}
