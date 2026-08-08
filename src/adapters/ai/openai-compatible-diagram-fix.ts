import type { AiSettings, DiagramFixPort, DiagramFixResult } from '../../application/index.js'
import { isAiConfigured } from '../../application/index.js'

export interface ChatMessage {
  readonly role: 'system' | 'user'
  readonly content: string
}

/**
 * One authenticated OpenAI-compatible `/chat/completions` call.
 *
 * The only thing that differs by platform. The packaged app's CSP forbids a
 * frontend `fetch` to an external host, so its transport goes through a Rust
 * command instead; the browser dev shell's transport is a plain `fetch`. Both
 * return the raw response body text — parsing the OpenAI response shape stays
 * in one place (this file) rather than being duplicated per platform.
 */
export type ChatCompletionTransport = (
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: readonly ChatMessage[],
) => Promise<string>

const SYSTEM_PROMPT =
  'You fix broken diagram source code embedded in a Markdown document. ' +
  'You will be given the diagram language, the current source, and the error its renderer produced. ' +
  'Reply with ONLY the corrected source in that same language — no explanation, no surrounding prose, ' +
  'no Markdown code fence.'

function userTurn(language: string, source: string, errorMessage: string): string {
  return [
    `Diagram type: ${language}`,
    `Error: ${errorMessage}`,
    '',
    'Source:',
    source,
  ].join('\n')
}

/** Strips a Markdown fence the model wrapped its answer in, despite being asked not to. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const match = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(trimmed)
  return (match?.[1] ?? trimmed).trim()
}

/** Parses an OpenAI-shape chat-completion response body into a fix result. */
export function extractFixedSource(responseText: string): DiagramFixResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(responseText)
  } catch {
    return { ok: false, message: 'The API response was not valid JSON.' }
  }
  const content = (parsed as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    return { ok: false, message: 'The API response did not include a message.' }
  }
  const source = stripCodeFence(content)
  if (source === '') {
    return { ok: false, message: 'The API returned an empty answer.' }
  }
  return { ok: true, source }
}

export type ModelListResult =
  | { readonly ok: true; readonly models: readonly string[] }
  | { readonly ok: false; readonly message: string }

/**
 * One authenticated OpenAI-compatible `GET /models` call.
 *
 * Same reasoning as `ChatCompletionTransport`: the packaged app's CSP means
 * this goes through a Rust command there, and a plain `fetch` in the browser
 * dev shell.
 */
export type ModelListTransport = (baseUrl: string, apiKey: string) => Promise<string>

/** Ids that answer to a chat prompt, not a specialised capability the Fix-it flow cannot use. */
const NON_CHAT_MODEL_PATTERN = /embedding|whisper|dall-e|tts|moderation|-instruct|-audio|-realtime|-image|-transcribe/

/** Parses a `GET /models` response body into the chat-capable model ids, sorted. */
export function parseModelList(responseText: string): ModelListResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(responseText)
  } catch {
    return { ok: false, message: 'The API response was not valid JSON.' }
  }
  const data = (parsed as { data?: unknown }).data
  if (!Array.isArray(data)) {
    return { ok: false, message: 'The API response did not include a model list.' }
  }
  const ids = data
    .map((entry) => (entry as { id?: unknown }).id)
    .filter((id): id is string => typeof id === 'string')
  const chatModels = ids.filter((id) => !NON_CHAT_MODEL_PATTERN.test(id)).sort()
  if (chatModels.length === 0) {
    return { ok: false, message: 'The API returned no chat models.' }
  }
  return { ok: true, models: chatModels }
}

/** Fetches and parses the model list. Never throws — a transport failure resolves `{ ok: false }`. */
export async function listModels(
  transport: ModelListTransport,
  baseUrl: string,
  apiKey: string,
): Promise<ModelListResult> {
  try {
    const responseText = await transport(baseUrl, apiKey)
    return parseModelList(responseText)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message }
  }
}

export class OpenAiCompatibleDiagramFixPort implements DiagramFixPort {
  constructor(
    private readonly transport: ChatCompletionTransport,
    private readonly getSettings: () => AiSettings,
  ) {}

  isConfigured(): boolean {
    return isAiConfigured(this.getSettings())
  }

  async fix(language: string, source: string, errorMessage: string): Promise<DiagramFixResult> {
    const settings = this.getSettings()
    if (!isAiConfigured(settings)) {
      return { ok: false, message: 'Add an API key in Settings before using Fix it.' }
    }
    try {
      const responseText = await this.transport(settings.baseUrl, settings.apiKey, settings.model, [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userTurn(language, source, errorMessage) },
      ])
      return extractFixedSource(responseText)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, message }
    }
  }
}
