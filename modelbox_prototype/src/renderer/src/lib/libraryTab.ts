import type { HfModelLibrary } from "@shared/types";

export const LIBRARY_MODE_KEY = "llamafont-models-library";

export function readLibraryTab(): HfModelLibrary {
  try {
    const v = localStorage.getItem(LIBRARY_MODE_KEY);
    if (v === "vllm" || v === "llama") return v;
  } catch {
    /* ignore */
  }
  return "llama";
}

export function writeLibraryTab(tab: HfModelLibrary): void {
  try {
    localStorage.setItem(LIBRARY_MODE_KEY, tab);
  } catch {
    /* ignore */
  }
}
