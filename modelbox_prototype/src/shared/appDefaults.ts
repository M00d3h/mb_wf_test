/** Fallback list when no models directories are configured. Empty — the main process seeds ~/.modelbox/models via DB. */
export const DEFAULT_MODELS_DIRS: string[] = [];

/** Non-empty paths only; if none, returns the same empty array. */
export function persistModelsDirs(dirs: string[]): string[] {
  return dirs.map((d) => d.trim()).filter(Boolean);
}

/** vLLM roots: may be empty; no implicit default path. */
export function persistVllmModelDirs(dirs: string[]): string[] {
  return dirs.map((d) => d.trim()).filter(Boolean);
}
