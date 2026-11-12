import type { VllmModel, VllmModelConfig } from '@shared/types'

export function makeVllmModel(overrides: Partial<VllmModel> = {}): VllmModel {
  return {
    id: 'test-vllm-model',
    path: '/home/user/models/Mistral-7B-Instruct-v0.3',
    displayName: 'Mistral-7B-Instruct-v0.3',
    config: {} as VllmModelConfig,
    diskSize: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}
