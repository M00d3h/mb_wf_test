import fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { getSettings } from '../db/repos/settings.repo'
import { parseWslUncPath } from '../utils/wslPath'

/** Normalize paths for comparison: forward slashes, lowercase, unify WSL UNC formats. */
function norm(p: string): string {
  return p
    .replace(/\\/g, '/')
    .replace(/^\/\/wsl\$\//, '//wsl.localhost/')
    .replace(/^\/\/wsl\.localhost\//, '//wsl.localhost/')
    .toLowerCase()
}

/** True if `filePath` is inside (or equal to) one of the configured vLLM model dirs. */
function isUnderVllmDirs(targetPath: string): boolean {
  const settings = getSettings()
  const dirs = settings.vllmModelDirs ?? []
  const target = norm(targetPath)
  for (const d of dirs) {
    const dir = norm(d)
    // Allow exact match or sub-path (with separator to avoid prefix false-positives)
    if (target === dir || target.startsWith(dir + '/')) return true
  }
  return false
}

/**
 * Deletes the entire vLLM model directory on disk.
 * Only deletes if the path is under a configured vLLM model dir.
 * For WSL UNC paths, uses `wsl.exe rm -rf` because the Windows 9P mount
 * cannot reliably delete symlink-heavy HF hub cache directories.
 */
export async function deleteVllmModelFiles(modelPath: string): Promise<void> {
  if (!isUnderVllmDirs(modelPath)) {
    throw new Error(
      `Model path "${modelPath}" is not under a configured vLLM model directory — refusing to delete.`
    )
  }

  // For WSL UNC paths, delete through wsl.exe — the 9P mount can't handle
  // symlink-heavy HF hub caches (readdir/stat/rm all fail on ext4 symlinks).
  const wsl = parseWslUncPath(modelPath)
  if (wsl && process.platform === 'win32') {
    try {
      execFileSync(
        'wsl.exe',
        ['-d', wsl.distro, 'rm', '-rf', wsl.linuxPath],
        { timeout: 120_000 }
      )
      return
    } catch (e) {
      throw new Error(`Could not delete model directory via WSL: ${(e as Error).message}`)
    }
  }

  try {
    await fs.rm(path.resolve(modelPath), { recursive: true, force: true })
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return
    throw new Error(`Could not delete model directory: ${(e as Error).message}`)
  }
}
