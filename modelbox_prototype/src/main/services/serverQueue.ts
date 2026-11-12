import { v4 as uuidv4 } from 'uuid'
import { BrowserWindow } from 'electron'
import type { QueueEntry } from '@shared/types'

type LaunchFn = () => Promise<void>

interface QueueItem {
  entry: QueueEntry
  launch: LaunchFn
}

let queue: QueueItem[] = []
let processing = false

function sendUpdate(): void {
  const wins = BrowserWindow.getAllWindows()
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send('server:queue-update', { queue: queue.map((q) => q.entry) })
    }
  }
}

export async function enqueue(
  profileId: string,
  modelName: string,
  profileName: string,
  port: number,
  launch: LaunchFn
): Promise<string> {
  const id = uuidv4()
  const entry: QueueEntry = {
    id,
    profileId,
    modelName,
    profileName,
    port,
    enqueuedAt: Date.now()
  }
  queue.push({ entry, launch })
  sendUpdate()
  processQueue()
  return id
}

export function cancelQueued(id: string): void {
  queue = queue.filter((q) => q.entry.id !== id)
  sendUpdate()
}

export function clearQueue(): void {
  queue = []
  sendUpdate()
}

async function processQueue(): Promise<void> {
  if (processing || queue.length === 0) return
  processing = true
  const next = queue.shift()!
  sendUpdate()
  try {
    await next.launch()
  } catch (err) {
    console.error('[queue] launch failed', err)
  }
  processing = false
  processQueue()
}

export function getQueue(): QueueEntry[] {
  return queue.map((q) => q.entry)
}
