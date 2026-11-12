import type { VllmEnvKind, VllmRuntimeConfig } from "./types";

/** Coerce invalid / null `envKind` from stored JSON so Windows never falls through to bare `vllm`. */
export function normalizeVllmRuntime(rt: VllmRuntimeConfig): VllmRuntimeConfig {
  const k = rt.envKind as VllmEnvKind | undefined | null;
  const envKind: VllmEnvKind =
    k === "conda" || k === "venv" || k === "docker" ? k : "conda";
  return envKind === rt.envKind ? rt : { ...rt, envKind };
}
