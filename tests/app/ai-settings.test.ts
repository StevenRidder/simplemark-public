import { describe, expect, it } from 'vitest'

import {
  DEFAULT_AI_SETTINGS,
  isAiConfigured,
  loadAiSettings,
  normaliseAiSettings,
  saveAiSettings,
} from '../../src/app/ai-settings.js'

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = { ...initial }
  return {
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value
    },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  } as Storage
}

describe('normaliseAiSettings', () => {
  it('falls back to defaults for garbage input', () => {
    expect(normaliseAiSettings(null)).toEqual(DEFAULT_AI_SETTINGS)
    expect(normaliseAiSettings('nope')).toEqual(DEFAULT_AI_SETTINGS)
    expect(normaliseAiSettings({})).toEqual(DEFAULT_AI_SETTINGS)
  })

  it('trims strings and strips a trailing slash from the base URL', () => {
    expect(
      normaliseAiSettings({ apiKey: '  sk-abc  ', baseUrl: 'https://x.test/v1/', model: ' gpt-4o ' }),
    ).toEqual({ apiKey: 'sk-abc', baseUrl: 'https://x.test/v1', model: 'gpt-4o' })
  })

  it('falls back to the default base URL when the given one is blank', () => {
    expect(normaliseAiSettings({ baseUrl: '   ' }).baseUrl).toBe(DEFAULT_AI_SETTINGS.baseUrl)
  })
})

describe('isAiConfigured', () => {
  it('requires all three fields non-empty', () => {
    expect(isAiConfigured(DEFAULT_AI_SETTINGS)).toBe(false)
    expect(isAiConfigured({ apiKey: 'k', baseUrl: 'https://x.test', model: '' })).toBe(false)
    expect(isAiConfigured({ apiKey: 'k', baseUrl: 'https://x.test', model: 'gpt-4o' })).toBe(true)
  })
})

describe('load/save round trip', () => {
  it('persists and reloads settings', () => {
    const storage = fakeStorage()
    saveAiSettings(storage, { apiKey: 'k', baseUrl: 'https://x.test', model: 'gpt-4o' })
    expect(loadAiSettings(storage)).toEqual({ apiKey: 'k', baseUrl: 'https://x.test', model: 'gpt-4o' })
  })

  it('returns defaults when nothing is stored or storage throws', () => {
    expect(loadAiSettings(fakeStorage())).toEqual(DEFAULT_AI_SETTINGS)
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
    } as unknown as Pick<Storage, 'getItem'>
    expect(loadAiSettings(throwing)).toEqual(DEFAULT_AI_SETTINGS)
  })
})
