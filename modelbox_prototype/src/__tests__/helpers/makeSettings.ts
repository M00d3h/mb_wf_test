import type { AppSettings } from '@shared/types'

export function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    modelsDirs: ['/models'],
    vllmModelDirs: [],
    vllmRuntime: { envKind: 'venv' },
    llamaServerPath: '/usr/local/bin/llama-server',
    cudaBinPath: '',
    llamaDefaultHost: '127.0.0.1',
    llamaBasePort: 8080,
    vllmDefaultHost: '127.0.0.1',
    vllmBasePort: 8000,
    firstRun: false,
    fontSize: 14,
    wslMode: false,
    ...overrides,
  }
}
