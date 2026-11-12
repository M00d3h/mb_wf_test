import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "./ipc";

const STORAGE_KEY = "hf_avatar_url_cache";

const publisherAvatarUrlMemory = new Map<string, string | null>();

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, string | null>;
    for (const [slug, url] of Object.entries(parsed)) {
      publisherAvatarUrlMemory.set(slug, url);
    }
  } catch {}
}

function saveToStorage(): void {
  try {
    const obj: Record<string, string | null> = {};
    for (const [slug, url] of publisherAvatarUrlMemory) {
      obj[slug] = url;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {}
}

loadFromStorage();

export const loadedAvatarUrls = new Set<string>();

/**
 * Publishers that are queued in an in-flight batch request.
 * Individual hooks skip their own IPC call when a slug appears here,
 * preventing 25+ simultaneous IPC calls when a page of models loads.
 * Populated synchronously before React re-renders so child effects see it.
 */
const pendingBatchSlugs = new Set<string>();

/**
 * Listeners registered by mounted usePublisherAvatarUrl hooks.
 * Called with the set of slugs that were just added to the memory cache,
 * so only affected hooks re-render — not all 25 at once.
 */
const cacheUpdateListeners = new Set<(updated: ReadonlySet<string>) => void>();

/**
 * Batch-prime the renderer-side avatar cache for a list of slugs.
 *
 * Call this BEFORE setModels() so pendingBatchSlugs is populated synchronously
 * before React renders the new rows and their useEffect hooks run.
 * This prevents individual hooks from firing separate IPC calls for the same slugs.
 */
export function prefetchPublisherAvatars(slugs: string[]): void {
  const toFetch = slugs.filter(
    (s) => s && !publisherAvatarUrlMemory.has(s) && !pendingBatchSlugs.has(s),
  );
  if (toFetch.length === 0) return;

  for (const s of toFetch) pendingBatchSlugs.add(s);

  void api.hf
    .getPublisherAvatarsBatch(toFetch)
    .then((result) => {
      const updated = new Set<string>();
      for (const [slug, url] of Object.entries(result)) {
        pendingBatchSlugs.delete(slug);
        if (!publisherAvatarUrlMemory.has(slug)) {
          publisherAvatarUrlMemory.set(slug, url);
          updated.add(slug);
        }
      }
      if (updated.size > 0) {
        saveToStorage();
        for (const fn of cacheUpdateListeners) fn(updated);
      }
    })
    .catch(() => {
      for (const s of toFetch) pendingBatchSlugs.delete(s);
    });
}

/**
 * Resolves the Hugging Face user/org avatar URL for a namespace slug.
 * Reads from the renderer-side memory cache instantly; defers to a single IPC call
 * only if the slug is not already cached and not covered by a pending batch request.
 */
export function usePublisherAvatarUrl(slug: string | null): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    slug != null && publisherAvatarUrlMemory.has(slug)
      ? publisherAvatarUrlMemory.get(slug)!
      : null,
  );

  // Keep a ref so the batch listener closure always reads the current slug.
  const slugRef = useRef(slug);
  slugRef.current = slug;

  useLayoutEffect(() => {
    if (!slug) {
      setUrl(null);
      return;
    }
    const cached = publisherAvatarUrlMemory.get(slug);
    setUrl(cached !== undefined ? cached : null);
  }, [slug]);

  // Subscribe to batch completion so this hook re-renders when its slug resolves.
  useEffect(() => {
    const listener = (updated: ReadonlySet<string>): void => {
      const s = slugRef.current;
      if (s && updated.has(s)) {
        setUrl(publisherAvatarUrlMemory.get(s) ?? null);
      }
    };
    cacheUpdateListeners.add(listener);
    return () => {
      cacheUpdateListeners.delete(listener);
    };
  }, []);

  // Only fire a solo IPC call if the slug is not cached AND not in a pending batch.
  useEffect(() => {
    if (!slug || publisherAvatarUrlMemory.has(slug) || pendingBatchSlugs.has(slug)) return;
    let cancelled = false;
    void api.hf.getPublisherAvatar(slug).then((u) => {
      pendingBatchSlugs.delete(slug);
      publisherAvatarUrlMemory.set(slug, u);
      saveToStorage();
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return url;
}
