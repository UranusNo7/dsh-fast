import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { ModelPolicyAdapter } from '@deepseek-ai/dsh-llm-model-policy'
import type { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveConfig } from '../src/config.ts'
import type { Config } from '../src/config.ts'

const IMAGE_REF = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png' as const,
  bytes: 1,
  width: 1,
  height: 1,
}

class FakePhysicalAdapter {
  readonly calls: GenerateOptions[] = []

  constructor(
    private readonly infos: Record<string, LlmResolvedModelInfo>,
    private readonly streams: Record<string, readonly StreamChunk[]>,
  ) {}

  resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const info = this.infos[`${provider}/${model}`]
    if (info === undefined) throw new Error(`missing fake model ${provider}/${model}`)
    return Promise.resolve(info)
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls.push(options)
    for (const chunk of this.streams[options.provider] ?? []) yield chunk
  }
}

function config(model: NonNullable<Config['models']>): ReturnType<typeof resolveConfig> {
  return resolveConfig({
    providerId: 'policy',
    displayName: 'Policy',
    providers: {},
    models: model,
  })
}

function info(provider: string, model: string, inputModalities: ('text' | 'image')[]): LlmResolvedModelInfo {
  return {
    provider,
    id: model,
    name: model,
    inputModalities,
    context: { contextWindow: 1000 },
    reasoning: {
      efforts: [{ id: ReasoningEffortId('high'), name: 'high' }],
      defaultEffort: ReasoningEffortId('high'),
    },
  }
}

function request(messages: GenerateOptions['messages'] = []): GenerateOptions {
  return { provider: 'policy', model: 'gpt', messages }
}

describe('ModelPolicyAdapter', () => {
  it('publishes logical metadata and intersects reasoning with physical routes', async () => {
    const physical = new FakePhysicalAdapter(
      { 'primary/gpt': info('primary', 'gpt', ['text', 'image']) },
      {},
    )
    const adapter = new ModelPolicyAdapter(config({
      gpt: {
        maxTokens: 128000,
        input: ['text', 'image'],
        reasoning: { default: 'high', allowed: ['off', 'high'] },
        routes: [{ provider: 'primary', model: 'gpt' }],
      },
    }), () => physical as unknown as PiAiAdapter)

    await expect(adapter.resolveModel('policy', 'gpt')).resolves.toMatchObject({
      id: 'gpt',
      inputModalities: ['text', 'image'],
      defaultMaxTokens: 128000,
      reasoning: {
        efforts: [
          { id: 'off', name: 'off' },
          { id: 'high', name: 'high' },
        ],
        defaultEffort: 'high',
      },
    })
  })

  it('selects the request-level service tier for physical routes', async () => {
    const physical = new FakePhysicalAdapter(
      { 'primary/gpt': info('primary', 'gpt', ['text']) },
      { primary: [{ type: 'finish', reason: { kind: 'stop' } }] },
    )
    const tiers: unknown[] = []
    const adapter = new ModelPolicyAdapter(config({
      gpt: {
        routes: [{ provider: 'primary', model: 'gpt' }],
      },
    }), (tier) => {
      tiers.push(tier)
      return physical as unknown as PiAiAdapter
    })

    for await (const _chunk of adapter.stream({ ...request(), serviceTier: 'fast' })) { /* drain */ }

    expect(tiers).toEqual(['fast'])
    expect(physical.calls[0]?.serviceTier).toBe('fast')
  })

  it('excludes text-only routes from image requests', async () => {
    const physical = new FakePhysicalAdapter(
      {
        'text/gpt': info('text', 'gpt', ['text']),
        'vision/gpt': info('vision', 'gpt', ['text', 'image']),
      },
      {
        vision: [{ type: 'finish', reason: { kind: 'stop' } }],
      },
    )
    const adapter = new ModelPolicyAdapter(config({
      gpt: {
        input: ['text', 'image'],
        routes: [
          { provider: 'text', model: 'gpt', priority: 10 },
          { provider: 'vision', model: 'gpt', priority: 20 },
        ],
      },
    }), () => physical as unknown as PiAiAdapter)

    for await (const _chunk of adapter.stream(request([createUserMessage({
      content: [{ type: 'image', attachment: IMAGE_REF }],
      source: { kind: 'user' },
    })]))) { /* drain */ }

    expect(physical.calls.map(call => call.provider)).toEqual(['vision'])
  })

  it('fails over before content is emitted and suppresses the failed finish chunk', async () => {
    const physical = new FakePhysicalAdapter(
      {
        'primary/gpt': info('primary', 'gpt', ['text']),
        'backup/gpt': info('backup', 'gpt', ['text']),
      },
      {
        primary: [{
          type: 'finish',
          reason: { kind: 'error', failure: { code: 'SERVER', message: 'temporary' } },
        }],
        backup: [
          { type: 'block-start', index: 0, blockType: 'text' },
          { type: 'text-delta', index: 0, text: 'ok' },
          { type: 'finish', reason: { kind: 'stop' } },
        ],
      },
    )
    const adapter = new ModelPolicyAdapter(config({
      gpt: {
        routes: [
          { provider: 'primary', model: 'gpt', priority: 10 },
          { provider: 'backup', model: 'gpt', priority: 20 },
        ],
      },
    }), () => physical as unknown as PiAiAdapter)

    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream(request())) chunks.push(chunk)

    expect(physical.calls.map(call => call.provider)).toEqual(['primary', 'backup'])
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'ok' },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })
})
