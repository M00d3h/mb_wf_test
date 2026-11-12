import type { Model, Profile, VllmModel } from "@shared/types";

function fileName(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

function matchesThinkingPatterns(blob: string): boolean {
  if (
    /\b(qwen[-_]?3|qwen3|qwen[-_]?2\.5|qwen[-_]?2_5|qwen2\.5|qwen2_5)\b/.test(
      blob,
    )
  )
    return true;
  if (/\b(deepseek[-_]?r1|r1-distill|deepseek.*reasoner)\b/.test(blob))
    return true;
  if (/\b(gpt-oss|gpt_oss)\b/.test(blob)) return true;
  if (/\b(gemma[-_ ]?4)\b/.test(blob)) return true;
  if (
    /\b(qwen.*thinking|gemma.*thinking|thinking|[-_]think\.|\.think\.|_reasoning_)\b/.test(
      blob,
    )
  )
    return true;
  return false;
}

/**
 * Best-effort detection of models whose templates support llama.cpp
 * `chat_template_kwargs.enable_thinking` (Qwen3, DeepSeek-R1, etc.).
 */
export function isThinkingCapableModel(model: Model | undefined): boolean {
  if (!model || model.isEmbedding) return false;
  const blob = `${model.name} ${fileName(model.ggufPath)}`.toLowerCase();
  if (/\b(embedding|embed|bge-|e5-|nomic-embed)\b/.test(blob)) return false;
  return matchesThinkingPatterns(blob);
}

/**
 * Best-effort detection of vLLM models that support reasoning/thinking
 * (Qwen3, DeepSeek-R1, etc.) via `chat_template_kwargs.enable_thinking`.
 */
export function isThinkingCapableVllmModel(
  model: VllmModel | undefined,
): boolean {
  if (!model) return false;
  if (model.config?.reasoningParser) return true;
  const blob = `${model.displayName} ${fileName(model.path)}`.toLowerCase();
  return matchesThinkingPatterns(blob);
}

/** True when `path` looks like a multimodal projector file (filename heuristic). */
export function pathLooksLikeMmprojFile(path: string | undefined): boolean {
  if (!path?.trim()) return false;
  return /mmproj/i.test(fileName(path));
}

export function resolveProfileMmprojForModel(
  modelId: string,
  profilesByModel: Record<string, Profile[]>,
): string | undefined {
  const list = profilesByModel[modelId];
  if (!list?.length) return undefined;
  const active = list.find((p) => p.active);
  const fromActive = active?.config.mmproj?.trim();
  if (fromActive) return fromActive;
  return list.find((p) => p.config.mmproj?.trim())?.config.mmproj?.trim();
}

/**
 * Detect vLLM models that support vision/image inputs.
 * Primary: `isMultimodal` flag set at scan time from config.json (`vision_config` / `image_token_id`).
 * Fallback: name heuristics for models scanned before the flag was introduced.
 */
export function isVisionCapableVllmModel(model: VllmModel | undefined): boolean {
  if (!model) return false;
  if (model.isMultimodal != null) return model.isMultimodal;
  const blob = `${model.displayName} ${fileName(model.path)}`.toLowerCase();
  return /\b(llava|qwen.*vl|qwen.*vision|internvl|phi.*vision|pixtral|cogvlm|minicpm.*v|idefics|deepseek.*vl|mplug|moondream|florence|paligemma|gemma.*vision|molmo|ovis|llama.*vision|llama3.*v|mistral.*vision)\b/.test(blob);
}

/**
 * Vision / multimodal in the UI: DB flag from disk scan, detected sibling mmproj,
 * or a saved profile path that names an mmproj file.
 */
export function modelHasVisionCapability(
  model: Model | undefined,
  profileMmproj: string | undefined,
): boolean {
  if (!model || model.isEmbedding) return false;
  if (model.isMultimodal) return true;
  if (model.detectedFiles?.some((f) => pathLooksLikeMmprojFile(f))) return true;
  if (pathLooksLikeMmprojFile(profileMmproj)) return true;
  return false;
}
