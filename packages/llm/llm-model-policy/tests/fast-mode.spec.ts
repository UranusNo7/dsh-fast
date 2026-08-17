import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import Commands from '@deepseek-ai/dsh-commands'
import CredentialsLocal from '@deepseek-ai/dsh-credentials-local'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ModelPolicy from '@deepseek-ai/dsh-llm-model-policy'
import { closeMockServers, mockServer, textEvents } from '../../llm-pi-ai/tests/mock-server.ts'

const signal = new AbortController().signal
let credentialRoot: string | undefined

afterEach(async () => {
  await closeMockServers()
  if (credentialRoot !== undefined) await rm(credentialRoot, { recursive: true, force: true })
  credentialRoot = undefined
})

function policyConfig(baseURL = 'https://example.test/v1') {
  return {
    providerId: 'model-policy',
    providers: {
      primary: {
        apiKeyEnv: 'POLICY_KEY',
        api: 'openai-completions',
        baseURL,
        models: [{ id: 'gpt', name: 'GPT', contextWindow: 1000, maxTokens: 1000 }],
      },
    },
    models: {
      'gpt-5.6': {
        name: 'GPT-5.6',
        contextWindow: 1000,
        maxTokens: 1000,
        supportsFast: true,
        routes: [{ provider: 'primary', model: 'gpt' }],
      },
      'grok-4.6': {
        name: 'Grok 4.6',
        contextWindow: 1000,
        maxTokens: 1000,
        routes: [{ provider: 'primary', model: 'gpt' }],
      },
    },
  }
}

async function mount(): Promise<{ ctx: Context; agent: Agent }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(Commands)
  await ctx.plugin(ModelPolicy, policyConfig())
  const session = ctx.sessions.create(SessionId('fast-mode'))
  const agent = {
    id: session.id,
    options: { provider: 'model-policy', model: 'gpt-5.6' },
    session,
    ctx,
  } as unknown as Agent
  return { ctx, agent }
}

async function request(ctx: Context, agent: Agent) {
  return agentEvents(ctx, agent).waterfall(
    'agent/request',
    { turn: 1, step: 1, signal },
    () => Promise.resolve({ provider: agent.options.provider ?? '', model: agent.options.model ?? '' }),
  )
}

async function loopMount(baseURL: string): Promise<Context> {
  credentialRoot = await mkdtemp(join(tmpdir(), 'dsh-model-policy-fast-'))
  await writeFile(join(credentialRoot, '.credentials.yaml'), 'POLICY_KEY: test-key\n', { mode: 0o600 })
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(CredentialsLocal, { path: join(credentialRoot, '.credentials.yaml'), watch: false })
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: 'Fast mode test' })
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(Commands)
  await ctx.plugin(ModelPolicy, policyConfig(baseURL))
  return ctx
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise(resolve => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject !== agent || status !== 'idle') return
      dispose()
      resolve()
    })
  })
}

describe('llm-model-policy Fast session mode', () => {
  it('enables, reports, and disables Fast on a GPT logical model', async () => {
    const { ctx, agent } = await mount()
    try {
      await expect(ctx.commands.execute(agent, '/fast status', signal)).resolves.toMatchObject({
        result: { kind: 'success', text: 'Fast mode is disabled for this session.' },
      })

      await expect(ctx.commands.execute(agent, '/fast', signal)).resolves.toMatchObject({
        result: { kind: 'success', text: 'Fast mode enabled for this session.' },
      })
      await expect(request(ctx, agent)).resolves.toMatchObject({
        provider: 'model-policy',
        model: 'gpt-5.6',
        serviceTier: 'fast',
      })
      expect(agent.session.events.filter(event => event.type === 'model-policy/fast').at(-1)?.data).toEqual({ active: true })
      expect(agent.session.events.find(event => event.type === 'command/run')?.data).not.toHaveProperty('args')

      await expect(ctx.commands.execute(agent, '/fast status', signal)).resolves.toMatchObject({
        result: { kind: 'success', text: 'Fast mode is enabled for this session.' },
      })
      await expect(ctx.commands.execute(agent, '/fast off', signal)).resolves.toMatchObject({
        result: { kind: 'success', text: 'Fast mode disabled for this session.' },
      })
      await expect(request(ctx, agent)).resolves.toMatchObject({
        provider: 'model-policy',
        model: 'gpt-5.6',
      })
      expect((await request(ctx, agent)).serviceTier).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects Fast for non-GPT models and enforces the rule in request middleware', async () => {
    const { ctx, agent } = await mount()
    try {
      await ctx.commands.execute(agent, '/fast', signal)
      agent.options.model = 'grok-4.6'
      await ctx.commands.execute(agent, '/fast off', signal)
      await ctx.commands.execute(agent, '/fast', signal).then(result => {
        expect(result?.result).toEqual({ kind: 'error', text: 'Fast mode is available only for GPT logical models.' })
      })

      agent.session.append('model-policy/fast', { active: true })
      await expect(request(ctx, agent)).rejects.toMatchObject({
        code: 'UNSUPPORTED_OPTION',
        message: 'Fast mode is available only for GPT logical models; disable it before selecting another model.',
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects malformed command arguments without changing session state', async () => {
    const { ctx, agent } = await mount()
    try {
      await expect(ctx.commands.execute(agent, '/fast maybe', signal)).resolves.toMatchObject({
        result: { kind: 'error', text: 'Usage: /fast [off|status]' },
      })
      expect(agent.session.events.some(event => event.type === 'model-policy/fast')).toBe(false)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('persists the Fast choice in request headers across loop steps', async () => {
    const server = await mockServer([
      { events: textEvents },
      { events: textEvents },
      { events: textEvents },
    ])
    const ctx = await loopMount(server.url)
    try {
      const agent = ctx.agentLoop.create(SessionId('fast-loop'), {
        provider: 'model-policy',
        model: 'gpt-5.6',
      })
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      expect(server.paths).toHaveLength(1)

      await ctx.commands.execute(agent, '/fast', signal)
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      expect(server.paths).toHaveLength(2)

      await ctx.commands.execute(agent, '/fast off', signal)
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'third' }], source: { kind: 'user' } }))
      await waitForIdle(ctx, agent)
      expect(server.paths).toHaveLength(3)

      const headers = agent.session.events
        .filter(event => event.type === 'request/header')
        .map(event => event.type === 'request/header' ? event.data.header.config.serviceTier : undefined)
      expect(headers).toEqual([undefined, 'fast', undefined])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
