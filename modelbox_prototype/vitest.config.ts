import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'src/main/services/**',
        'src/main/db/**',
        'src/renderer/src/store/**',
        'src/renderer/src/lib/**',
        'src/shared/**'
      ],
      exclude: [
        'src/main/ipc/**',
        'src/preload/**',
        'src/**/__tests__/**'
      ]
    }
  },
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer/src')
    }
  }
})
