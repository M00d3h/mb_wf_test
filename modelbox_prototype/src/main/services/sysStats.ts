import * as os from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'
import type { GpuStats, SystemStats } from '@shared/types'

const execAsync = promisify(exec)

// CPU sampling — requires two data points to compute a diff
let prevCpu: { total: number; idle: number } | null = null

function sampleCpu(): { total: number; idle: number } {
  let total = 0
  let idle = 0
  for (const cpu of os.cpus()) {
    for (const val of Object.values(cpu.times)) total += val
    idle += cpu.times.idle
  }
  return { total, idle }
}

function getCpuPercent(): number {
  const curr = sampleCpu()
  if (!prevCpu) {
    prevCpu = curr
    return 0
  }
  const totalDiff = curr.total - prevCpu.total
  const idleDiff = curr.idle - prevCpu.idle
  prevCpu = curr
  return totalDiff > 0 ? Math.max(0, Math.round((1 - idleDiff / totalDiff) * 100)) : 0
}


function getRam(): SystemStats['ram'] {
  const total = os.totalmem()
  const free = os.freemem()
  const used = total - free
  return {
    usedMb: Math.round(used / 1024 / 1024),
    totalMb: Math.round(total / 1024 / 1024),
    percent: Math.round((used / total) * 100)
  }
}

async function getGpu(): Promise<SystemStats['gpu']> {
  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,power.draw,power.limit --format=csv,noheader,nounits',
      { timeout: 2000 }
    )
    const lines = stdout.trim().split('\n')
    const gpus: GpuStats[] = []

    for (const line of lines) {
      const parts = line.split(',').map((s) => s.trim())
      if (parts.length >= 5) {
        const name = parts[0]
        const gpuPercent = parseFloat(parts[1])
        const memPercent = parseFloat(parts[2])
        const memUsedMb = parseFloat(parts[3])
        const memTotalMb = parseFloat(parts[4])
        
        const temperatureC = parts[5] !== undefined && !isNaN(parseFloat(parts[5])) ? Math.round(parseFloat(parts[5])) : undefined
        const powerDrawW = parts[6] !== undefined && !isNaN(parseFloat(parts[6])) ? Math.round(parseFloat(parts[6]) * 10) / 10 : undefined
        const powerLimitW = parts[7] !== undefined && !isNaN(parseFloat(parts[7])) ? parseFloat(parts[7]) : undefined
        const powerPercent =
          powerDrawW !== undefined && powerLimitW !== undefined && powerLimitW > 0
            ? Math.round((powerDrawW / powerLimitW) * 100)
            : undefined

        gpus.push({
          name,
          gpuPercent,
          memPercent,
          memUsedMb,
          memTotalMb,
          temperatureC,
          powerDrawW,
          powerLimitW,
          powerPercent
        })
      }
    }
    return gpus.length > 0 ? gpus : null
  } catch {
    return null
  }
}

async function getMacGpuPercent(): Promise<number | null> {
  // AGXAccelerator = Apple Silicon, IOAccelerator = Intel Mac
  for (const cls of ['AGXAccelerator', 'IOAccelerator']) {
    try {
      const { stdout } = await execAsync(`ioreg -r -d 1 -w 0 -c ${cls}`, { timeout: 2000 })
      // ioreg uses = as separator: "Device Utilization %"=5
      const re = /"Device Utilization %"\s*=\s*(\d+)/g
      let max: number | null = null
      let m: RegExpExecArray | null
      while ((m = re.exec(stdout)) !== null) {
        const v = parseInt(m[1], 10)
        if (max === null || v > max) max = v
      }
      if (max !== null) return max
    } catch {
      // try next class
    }
  }
  return null
}

export async function getSystemStats(): Promise<SystemStats> {
  const isMac = process.platform === 'darwin'
  const [cpuPercent, ram, gpu, macGpuPercent] = await Promise.all([
    Promise.resolve(getCpuPercent()),
    Promise.resolve(getRam()),
    isMac ? Promise.resolve(null) : getGpu(),
    isMac ? getMacGpuPercent() : Promise.resolve(null)
  ])
  return {
    cpu: { percent: cpuPercent },
    ram,
    gpu,
    platform: process.platform,
    ...(macGpuPercent !== null ? { macGpuPercent } : {})
  }
}
