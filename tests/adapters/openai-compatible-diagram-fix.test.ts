import { describe, expect, it } from 'vitest'

import { listModels, OpenAiCompatibleDiagramFixPort, parseModelList } from '../../src/adapters/ai/openai-compatible-diagram-fix.js'
import type { ChatMessage } from '../../src/adapters/ai/openai-compatible-diagram-fix.js'
import type { AiSettings } from '../../src/app/ai-settings.js'

const CONFIGURED: AiSettings = { apiKey: 'sk-abc', baseUrl: 'https://x.test/v1', model: 'gpt-4o' }
const UNCONFIGURED: AiSettings = { apiKey: '', baseUrl: 'https://api.openai.com/v1', model: '' }

function chatCompletionResponse(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }] })
}

describe('isConfigured', () => {
  it('reflects the current settings, not a snapshot taken at construction', () => {
    let settings = UNCONFIGURED
    const port = new OpenAiCompatibleDiagramFixPort(async () => '', () => settings)
    expect(port.isConfigured()).toBe(false)
    settings = CONFIGURED
    expect(port.isConfigured()).toBe(true)
  })
})

describe('fix', () => {
  it('refuses without needing a network call when unconfigured', async () => {
    const port = new OpenAiCompatibleDiagramFixPort(async () => {
      throw new Error('must not be called')
    }, () => UNCONFIGURED)
    const result = await port.fix('mermaid', 'flowchart TD', 'parse error')
    expect(result).toEqual({ ok: false, message: 'Add an API key in Settings before using Fix it.' })
  })

  it('sends the language, source, and error in the user turn, and passes settings through', async () => {
    let seen: { baseUrl: string; apiKey: string; model: string; messages: readonly ChatMessage[] } | undefined
    const port = new OpenAiCompatibleDiagramFixPort(async (baseUrl, apiKey, model, messages) => {
      seen = { baseUrl, apiKey, model, messages }
      return chatCompletionResponse('flowchart TD\n  A --> B')
    }, () => CONFIGURED)

    const result = await port.fix('mermaid', 'flowchart TD\n  A -> B', 'Parse error on line 1')
    expect(result).toEqual({ ok: true, source: 'flowchart TD\n  A --> B' })
    expect(seen?.baseUrl).toBe(CONFIGURED.baseUrl)
    expect(seen?.apiKey).toBe(CONFIGURED.apiKey)
    expect(seen?.model).toBe(CONFIGURED.model)
    expect(seen?.messages[0]?.role).toBe('system')
    expect(seen?.messages[1]).toEqual({
      role: 'user',
      content: expect.stringContaining('flowchart TD\n  A -> B') as unknown as string,
    })
    expect(seen?.messages[1]?.content).toContain('Parse error on line 1')
    expect(seen?.messages[1]?.content).toContain('mermaid')
  })

  it('strips a Markdown fence the model wrapped the answer in', async () => {
    const port = new OpenAiCompatibleDiagramFixPort(
      async () => chatCompletionResponse('```mermaid\nflowchart TD\n  A --> B\n```'),
      () => CONFIGURED,
    )
    const result = await port.fix('mermaid', 'broken', 'err')
    expect(result).toEqual({ ok: true, source: 'flowchart TD\n  A --> B' })
  })

  it('fails on an empty answer rather than writing a blank diagram', async () => {
    const port = new OpenAiCompatibleDiagramFixPort(async () => chatCompletionResponse('   '), () => CONFIGURED)
    const result = await port.fix('mermaid', 'broken', 'err')
    expect(result.ok).toBe(false)
  })

  it('fails on a response that is not the expected shape', async () => {
    const port = new OpenAiCompatibleDiagramFixPort(async () => '{"unexpected": true}', () => CONFIGURED)
    const result = await port.fix('mermaid', 'broken', 'err')
    expect(result.ok).toBe(false)
  })

  it('turns a transport rejection into an ok:false result instead of throwing', async () => {
    const port = new OpenAiCompatibleDiagramFixPort(async () => {
      throw new Error('API error 401: unauthorized')
    }, () => CONFIGURED)
    const result = await port.fix('mermaid', 'broken', 'err')
    expect(result).toEqual({ ok: false, message: 'API error 401: unauthorized' })
  })
})

function modelListResponse(ids: readonly string[]): string {
  return JSON.stringify({ data: ids.map((id) => ({ id })) })
}

describe('parseModelList', () => {
  it('extracts and sorts chat model ids', () => {
    const result = parseModelList(modelListResponse(['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo']))
    expect(result).toEqual({ ok: true, models: ['gpt-3.5-turbo', 'gpt-4o', 'gpt-4o-mini'] })
  })

  it('filters out non-chat model ids', () => {
    const result = parseModelList(modelListResponse([
      'gpt-4o',
      'text-embedding-3-small',
      'whisper-1',
      'dall-e-3',
      'tts-1',
      'text-moderation-latest',
      'gpt-3.5-turbo-instruct',
      'gpt-4o-realtime-preview',
      'gpt-4o-audio-preview',
      'gpt-image-1',
      'gpt-4o-transcribe',
    ]))
    expect(result).toEqual({ ok: true, models: ['gpt-4o'] })
  })

  it('fails on invalid JSON', () => {
    const result = parseModelList('not json')
    expect(result.ok).toBe(false)
  })

  it('fails on a response that is not the expected shape', () => {
    const result = parseModelList('{"unexpected": true}')
    expect(result.ok).toBe(false)
  })

  it('fails when nothing survives the chat-model filter', () => {
    const result = parseModelList(modelListResponse(['whisper-1', 'dall-e-3']))
    expect(result.ok).toBe(false)
  })
})

describe('listModels', () => {
  it('parses a successful transport response', async () => {
    const result = await listModels(
      async (baseUrl, apiKey) => {
        expect(baseUrl).toBe('https://x.test/v1')
        expect(apiKey).toBe('sk-abc')
        return modelListResponse(['gpt-4o'])
      },
      'https://x.test/v1',
      'sk-abc',
    )
    expect(result).toEqual({ ok: true, models: ['gpt-4o'] })
  })

  it('turns a transport rejection into an ok:false result instead of throwing', async () => {
    const result = await listModels(async () => {
      throw new Error('API error 401: unauthorized')
    }, 'https://x.test/v1', 'sk-abc')
    expect(result).toEqual({ ok: false, message: 'API error 401: unauthorized' })
  })
})
