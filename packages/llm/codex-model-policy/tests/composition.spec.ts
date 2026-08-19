/**
 * Real-composition coverage for the logical provider: a test-only cordis.yml
 * boots through the vendored Loader + Include path and exercises the physical
 * pi-ai request, so a namespace export or registration regression is visible.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import * as ModelPolicy from '@deepseek-ai/dsh-codex-model-policy'
import { closeMockServers, mockServer, textEvents } from '../../llm-pi-ai/tests/mock-server.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  await closeMockServers()
})

async function loadComposition(config: string): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-model-policy-composition-'))
  const credentialPath = join(root, '.credentials.yaml')
  await writeFile(credentialPath, 'PI_POLICY_KEY: key-from-store\n', { mode: 0o600 })
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    '- id: sessions',
    "  name: '@deepseek-ai/dsh-session'",
    '- id: credentials',
    "  name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: ${JSON.stringify(credentialPath)}`,
    '- id: codex-model-policy',
    "  name: '@deepseek-ai/dsh-codex-model-policy'",
    '  config:',
    ...config.split('\n').map(line => `    ${line}`),
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-credentials-local', CredentialsLocal],
    ['@deepseek-ai/dsh-codex-model-policy', ModelPolicy],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return ctx
}

function routeConfig(baseURL: string, extra: string): string {
  return [
    'providerId: gpt-policy',
    'providers:',
    '  primary:',
    '    apiKeyEnv: PI_POLICY_KEY',
    '    api: openai-completions',
    `    baseURL: ${JSON.stringify(baseURL)}`,
    '    models:',
    '      - id: gpt',
    '        name: GPT',
    '        contextWindow: 100000',
    '        maxTokens: 1000',
    '        input: [text]',
    'models:',
    '  gpt-5.6:',
    ...extra.split('\n').map(line => `    ${line}`),
  ].join('\n')
}

describe('codex-model-policy real Loader composition', () => {
  it('registers a logical provider and injects Fast into the physical request', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await loadComposition(routeConfig(server.url, [
      'maxTokens: 512',
      'supportsFast: true',
      'serviceTier: fast',
      'routes:',
      '  - provider: primary',
      '    model: gpt',
    ].join('\n')))
    const session = ctx.sessions.create(SessionId('composition-fast'))
    const agent = {
      id: session.id,
      options: { provider: 'gpt-policy', model: 'gpt-5.6' },
      session,
    } as unknown as Agent
    const controller = ctx.get('modelPolicy') as ModelPolicy.ModelPolicySessionController
    expect(controller.setFast(agent, { provider: 'gpt-policy', model: 'gpt-5.6' }, true))
      .toEqual({ active: true, available: true })
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request',
      { turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ provider: 'gpt-policy', model: 'gpt-5.6' }),
    )).resolves.toMatchObject({ serviceTier: 'fast' })

    const chunks = []
    for await (const chunk of ctx.llm.stream({
      provider: 'gpt-policy',
      model: 'gpt-5.6',
      messages: [],
    })) chunks.push(chunk)

    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(ctx.llm.listProviders()).toEqual([{ id: 'gpt-policy', name: 'Model Policy' }])
    expect(server.requests[0]).toMatchObject({ service_tier: 'priority', max_completion_tokens: 512 })
  })

  it('fails over a pre-content server failure to the next route', async () => {
    const primary = await mockServer([{ status: 500, body: JSON.stringify({ error: { message: 'primary down' } }) }])
    const backup = await mockServer([{ events: textEvents }])
    const ctx = await loadComposition([
      'providerId: gpt-policy',
      'providers:',
      '  primary:',
      '    apiKeyEnv: PI_POLICY_KEY',
      '    api: openai-completions',
      `    baseURL: ${JSON.stringify(primary.url)}`,
      '    models:',
      '      - id: gpt',
      '        name: GPT',
      '        contextWindow: 100000',
      '        maxTokens: 1000',
      '        input: [text]',
      '  backup:',
      '    apiKeyEnv: PI_POLICY_KEY',
      '    api: openai-completions',
      `    baseURL: ${JSON.stringify(backup.url)}`,
      '    models:',
      '      - id: gpt',
      '        name: GPT',
      '        contextWindow: 100000',
      '        maxTokens: 1000',
      '        input: [text]',
      'models:',
      '  gpt-5.6:',
      '    routes:',
      '      - provider: primary',
      '        model: gpt',
      '        priority: 10',
      '      - provider: backup',
      '        model: gpt',
      '        priority: 20',
    ].join('\n'))

    const chunks = []
    for await (const chunk of ctx.llm.stream({
      provider: 'gpt-policy',
      model: 'gpt-5.6',
      messages: [],
    })) chunks.push(chunk)

    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(primary.requests).toHaveLength(1)
    expect(backup.requests).toHaveLength(1)
  })
})
