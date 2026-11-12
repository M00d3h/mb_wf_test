// Keytar wrapper — stores API keys in Windows Credential Manager
// Falls back to in-memory store when keytar is unavailable (dev mode)

let keytar: typeof import('keytar') | null = null

try {
  keytar = require('keytar')
} catch {
  console.warn('[keychain] keytar not available, using in-memory fallback')
}

const SERVICE = 'llamafront'
const memStore = new Map<string, string>()

export async function setApiKey(profileId: string, apiKey: string): Promise<void> {
  if (keytar) {
    await keytar.setPassword(SERVICE, profileId, apiKey)
  } else {
    memStore.set(profileId, apiKey)
  }
}

export async function getApiKey(profileId: string): Promise<string | null> {
  if (keytar) {
    return keytar.getPassword(SERVICE, profileId)
  }
  return memStore.get(profileId) ?? null
}

export async function deleteApiKey(profileId: string): Promise<void> {
  if (keytar) {
    await keytar.deletePassword(SERVICE, profileId)
  } else {
    memStore.delete(profileId)
  }
}

const HF_TOKEN_KEY = '__hf_token__'

export async function setHfToken(token: string): Promise<void> {
  if (keytar) {
    await keytar.setPassword(SERVICE, HF_TOKEN_KEY, token)
  } else {
    memStore.set(HF_TOKEN_KEY, token)
  }
}

export async function getHfToken(): Promise<string | null> {
  if (keytar) {
    return keytar.getPassword(SERVICE, HF_TOKEN_KEY)
  }
  return memStore.get(HF_TOKEN_KEY) ?? null
}

export async function deleteHfToken(): Promise<void> {
  if (keytar) {
    await keytar.deletePassword(SERVICE, HF_TOKEN_KEY)
  } else {
    memStore.delete(HF_TOKEN_KEY)
  }
}
