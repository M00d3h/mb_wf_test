import type { ProfileConfig } from '@shared/types'

export function makeProfile(overrides: Partial<ProfileConfig> = {}): ProfileConfig {
  return { ...overrides }
}
