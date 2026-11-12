import type { Model } from '@shared/types'

export function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'test-model-id',
    name: 'test-model',
    ggufPath: '/models/test-q4_k_m.gguf',
    modelDir: '/models',
    isEmbedding: false,
    isMultimodal: false,
    detectedFiles: ['/models/test-q4_k_m.gguf'],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}
