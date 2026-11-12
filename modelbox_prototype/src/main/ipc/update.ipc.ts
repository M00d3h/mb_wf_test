import { ipcMain, app, shell } from 'electron'
import * as https from 'https'
import { wrapIpc } from './index'
import type { UpdateCheckResult } from '@shared/types'

// ── Configure your releases repository here ────────────────────────────────
const RELEASES_OWNER = 'M00d3h'
const RELEASES_REPO = 'ModelBox'
// ──────────────────────────────────────────────────────────────────────────

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'modelbox-app', Accept: 'application/vnd.github.v3+json' } }, (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk.toString() })
        res.on('end', () => {
          try { resolve(JSON.parse(data)) }
          catch (e) { reject(e) }
        })
      })
      .on('error', reject)
  })
}

function semverGt(a: string, b: string): boolean {
  const parse = (v: string): number[] =>
    v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na !== nb) return na > nb
  }
  return false
}

export function registerUpdateIpc(): void {
  wrapIpc('update:check', async (): Promise<UpdateCheckResult> => {
    const currentVersion = app.getVersion()
    try {
      const url = `https://api.github.com/repos/${RELEASES_OWNER}/${RELEASES_REPO}/releases/latest`
      const data = (await fetchJson(url)) as Record<string, unknown>

      const tagName = String(data.tag_name ?? '')
      const latestVersion = tagName.replace(/^v/, '')
      const releaseUrl = String(
        data.html_url ?? `https://github.com/${RELEASES_OWNER}/${RELEASES_REPO}/releases/latest`,
      )

      const assets = Array.isArray(data.assets) ? (data.assets as Record<string, unknown>[]) : []
      const ext = process.platform === 'darwin' ? '.dmg' : process.platform === 'win32' ? '.exe' : null
      let downloadUrl: string | null = null
      if (ext) {
        const asset = assets.find((a) => String(a.name ?? '').toLowerCase().endsWith(ext))
        if (asset) downloadUrl = String(asset.browser_download_url ?? '') || null
      }

      return { hasUpdate: semverGt(latestVersion, currentVersion), currentVersion, latestVersion, releaseUrl, downloadUrl }
    } catch {
      return { hasUpdate: false, currentVersion, latestVersion: currentVersion, releaseUrl: '', downloadUrl: null }
    }
  })

  ipcMain.handle('update:open-release', async (_event, url: string) => {
    if (typeof url === 'string' && url.startsWith('https://github.com/')) {
      await shell.openExternal(url)
    }
  })
}
