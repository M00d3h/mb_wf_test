import { ipcMain } from 'electron'
import * as os from 'os'
import { getSystemStats } from '../services/sysStats'


function scoreInterface(name: string, address: string): number {
  let score = 0
  const lowerName = name.toLowerCase()

  if (address.startsWith('192.168.')) score += 32
  else if (address.startsWith('10.')) score += 28
  // 172.16-31.x is nearly always WSL2/Hyper-V/Docker on Windows — treat as virtual, not a bonus
  else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) score -= 25

  if (lowerName.includes('wi-fi') || lowerName.includes('wifi')) score += 40
  if (lowerName.includes('wireless')) score += 30
  if (lowerName.includes('ethernet') && !lowerName.includes('vethernet')) score += 25
  if (lowerName.includes('local area connection')) score += 15

  if (lowerName.includes('wsl')) score -= 80
  if (lowerName.includes('hyper-v')) score -= 80
  if (lowerName.includes('vethernet')) score -= 80
  if (lowerName.includes('virtual')) score -= 60
  if (lowerName.includes('vmware')) score -= 60
  if (lowerName.includes('virtualbox')) score -= 60
  if (lowerName.includes('docker')) score -= 60
  if (lowerName.includes('default switch')) score -= 80
  if (lowerName.includes('nat')) score -= 40
  if (lowerName.includes('loopback')) score -= 100

  return score
}

function getLocalIp(): string {
  const ifaces = os.networkInterfaces()
  const candidates: Array<{ name: string; address: string; score: number }> = []

  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      candidates.push({
        name,
        address: addr.address,
        score: scoreInterface(name, addr.address)
      })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  if (candidates.length > 0) return candidates[0]!.address

  return '127.0.0.1'
}

export function registerSysStatsIpc(): void {
  ipcMain.handle('system:stats', async () => {
    return getSystemStats()
  })

  ipcMain.handle('system:local-ip', () => getLocalIp())
}
