import fs from 'node:fs/promises'
import path from 'node:path'
import type { Model } from '@shared/types'

/** True if `filePath` is a file inside `rootPath` (not the root itself). */
function isPathUnderRoot(filePath: string, rootPath: string): boolean {
  const f = path.resolve(filePath)
  const r = path.resolve(rootPath)
  if (f === r) return false
  const rel = path.relative(r, f)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * Deletes the model's GGUF files on disk (main + detectedFiles, e.g. mmproj).
 * Only paths under `model.modelDir` are removed.
 */
export async function deleteModelGgufFiles(model: Model): Promise<void> {
  const root = path.resolve(model.modelDir)
  const candidates = new Set<string>([model.ggufPath, ...model.detectedFiles])
  const errors: Error[] = []
  let pathsUnderRoot = 0

  for (const p of candidates) {
    const abs = path.resolve(p)
    if (!isPathUnderRoot(abs, root)) {
      console.warn('[deleteModelGgufFiles] skipping path outside model dir:', p)
      continue
    }
    pathsUnderRoot += 1
    try {
      await fs.unlink(abs)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT') continue
      errors.push(e instanceof Error ? e : new Error(String(e)))
    }
  }

  if (pathsUnderRoot === 0) {
    throw new Error('No GGUF files under the model directory could be deleted (invalid paths).')
  }

  if (errors.length > 0) {
    throw new Error(
      `Could not delete some model files: ${errors.map((e) => e.message).join('; ')}`,
    )
  }
}
