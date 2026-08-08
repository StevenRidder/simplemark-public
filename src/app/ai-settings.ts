/**
 * Credentials and endpoint for the diagram-error "Fix it" button (EDITOR
 * error-recovery). App state, never document content — nothing here is ever
 * written to a `.md` file, matching reader-preferences.ts's own reasoning.
 *
 * Plain localStorage, like every other preference in this app. That is a
 * known, deliberate tradeoff for a credential: no OS-keychain integration
 * exists anywhere in this codebase today, so adding one here would be new
 * infrastructure for one field rather than following an existing pattern.
 */

import type { AiSettings } from '../application/index.js'
import { isAiConfigured } from '../application/index.js'

export type { AiSettings }
export { isAiConfigured }

export const DEFAULT_AI_SETTINGS: AiSettings = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
}

function normaliseString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.trim() : fallback
}

/** Validates whatever came out of storage or a settings form — both untrusted. */
export function normaliseAiSettings(value: unknown): AiSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_AI_SETTINGS
  const candidate = value as Partial<Record<keyof AiSettings, unknown>>
  const baseUrl = normaliseString(candidate.baseUrl, DEFAULT_AI_SETTINGS.baseUrl).replace(/\/+$/, '')
  return {
    apiKey: normaliseString(candidate.apiKey, DEFAULT_AI_SETTINGS.apiKey),
    baseUrl: baseUrl === '' ? DEFAULT_AI_SETTINGS.baseUrl : baseUrl,
    model: normaliseString(candidate.model, DEFAULT_AI_SETTINGS.model),
  }
}

const AI_SETTINGS_KEY = 'simplemark.ai-settings'

export function loadAiSettings(storage: Pick<Storage, 'getItem'>): AiSettings {
  try {
    const raw = storage.getItem(AI_SETTINGS_KEY)
    return raw === null ? DEFAULT_AI_SETTINGS : normaliseAiSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_AI_SETTINGS
  }
}

export function saveAiSettings(storage: Pick<Storage, 'setItem'>, settings: AiSettings): void {
  try {
    storage.setItem(AI_SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // A key that cannot be persisted is not worth failing Settings over.
  }
}
