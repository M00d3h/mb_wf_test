import * as http from 'http'

interface HealthPollerOptions {
  host: string
  port: number
  intervalMs?: number
  timeoutMs?: number
  onHealthy: () => void
  onLoading: () => void
  onUnhealthy: (reason: string) => void
}

export class HealthPoller {
  private timer: NodeJS.Timeout | null = null
  private stopped = false
  private opts: Required<HealthPollerOptions>

  constructor(opts: HealthPollerOptions) {
    this.opts = {
      intervalMs: opts.intervalMs ?? 3000,
      timeoutMs: opts.timeoutMs ?? 30000,
      ...opts
    }
  }

  start(): void {
    this.stopped = false
    this.scheduleNext()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private scheduleNext(): void {
    if (this.stopped) return
    this.timer = setTimeout(() => this.poll(), this.opts.intervalMs)
  }

  private poll(): void {
    if (this.stopped) return
    const displayHost = this.opts.host === '0.0.0.0' ? '127.0.0.1' : this.opts.host
    const req = http.get(
      {
        hostname: displayHost,
        port: this.opts.port,
        path: '/health',
        timeout: this.opts.timeoutMs
      },
      (res) => {
        if (res.statusCode === 200) {
          this.opts.onHealthy()
        } else if (res.statusCode === 503) {
          this.opts.onLoading()
        } else {
          this.opts.onUnhealthy(`HTTP ${res.statusCode}`)
        }
        res.resume()
        this.scheduleNext()
      }
    )
    req.on('error', (err) => {
      if (!this.stopped) {
        this.opts.onUnhealthy(err.message)
        this.scheduleNext()
      }
    })
    req.on('timeout', () => {
      req.destroy()
      if (!this.stopped) {
        this.opts.onUnhealthy('timeout')
        this.scheduleNext()
      }
    })
  }
}
