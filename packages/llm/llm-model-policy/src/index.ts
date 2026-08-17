/** Logical cross-provider model policy plugin for DSH. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  LlmError,
} from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import {
  PiAiAdapter,
  resolvePiAiApiKey,
  resolveProfiles,
} from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiServiceTier } from '@deepseek-ai/dsh-llm-pi-ai'
import { profilesForServiceTier, resolveConfig } from './config.ts'
import { ModelPolicyAdapter } from './adapter.ts'
import type { Config } from './config.ts'
import type { ResolvedConfig, ResolvedModelPolicy } from './types.ts'
import { foldFastMode } from './fast.ts'

export { ModelPolicyAdapter } from './adapter.ts'
export { Config } from './config.ts'
export type {
  ModelPolicyModel,
  ModelPolicyReasoning,
  ModelPolicyRoute,
  ResolvedConfig,
  ResolvedModelPolicy,
  ResolvedModelPolicyRoute,
} from './types.ts'
export { foldFastMode } from './fast.ts'

export const name = 'llm-model-policy'
export const inject = ['llm', 'commands']

function physicalAdapterFor(
  ctx: Context,
  config: ResolvedConfig,
): (serviceTier: PiAiServiceTier | undefined) => PiAiAdapter {
  const adapters = new Map<string, PiAiAdapter>()
  return (serviceTier) => {
    const key = serviceTier ?? ''
    const existing = adapters.get(key)
    if (existing !== undefined) return existing
    const providers = profilesForServiceTier(config.providers, serviceTier)
    const snapshot = resolveProfiles(providers)
    const adapter = new PiAiAdapter({
      profiles: () => snapshot,
      resolveApiKey: (provider, profile) => resolvePiAiApiKey(ctx, provider, profile),
      resolveAttachments: () => ctx.get('attachments'),
    })
    adapters.set(key, adapter)
    return adapter
  }
}

async function validatePolicy(
  policy: ResolvedModelPolicy,
  physical: PiAiAdapter,
): Promise<void> {
  const infos = await Promise.all(policy.routes.map(route =>
    physical.resolveModel(route.provider, route.model)))
  for (const modality of policy.input) {
    if (modality === 'image' && !infos.some(info => info.inputModalities?.includes('image'))) {
      throw new LlmError(
        `model-policy logical model "${policy.id}" declares image input but no route declares image capability`,
        'UNSUPPORTED_CONTENT',
      )
    }
  }
  for (const effort of policy.reasoning.allowed ?? []) {
    if (effort !== 'off' && !infos.some(info =>
      info.reasoning?.efforts.some(candidate => String(candidate.id) === effort))) {
      throw new LlmError(
        `model-policy logical model "${policy.id}" has no route supporting reasoning "${effort}"`,
        'UNSUPPORTED_REASONING_EFFORT',
      )
    }
  }
}

const FAST_USAGE = 'Usage: /fast [off|status]'

function currentSelection(agent: Agent): { provider: string; model: string } {
  const config = agent.session.requestHeader()?.config
  return config === undefined
    ? { provider: agent.options.provider ?? '', model: agent.options.model ?? '' }
    : { provider: config.provider, model: config.model }
}

function policyForSelection(
  resolved: ResolvedConfig,
  selection: { provider: string; model: string },
): ResolvedModelPolicy | undefined {
  return selection.provider === resolved.providerId
    ? resolved.models.get(selection.model)
    : undefined
}

function fastCommand(
  invocation: CommandInvocation,
  resolved: ResolvedConfig,
): CommandResult {
  const input = invocation.rawInput.trim()
  if (input !== '' && input !== 'off' && input !== 'status') {
    return { kind: 'error', text: FAST_USAGE }
  }
  const active = foldFastMode(invocation.agent.session.events) === true
  if (input === 'status') {
    return {
      kind: 'success',
      text: active ? 'Fast mode is enabled for this session.' : 'Fast mode is disabled for this session.',
    }
  }
  if (input === '' && policyForSelection(resolved, currentSelection(invocation.agent))?.supportsFast !== true) {
    return { kind: 'error', text: 'Fast mode is available only for GPT logical models.' }
  }
  const nextActive = input !== 'off'
  if (active === nextActive) {
    return {
      kind: 'success',
      text: nextActive
        ? 'Fast mode is already enabled for this session.'
        : 'Fast mode is already disabled for this session.',
    }
  }
  const event = invocation.agent.session.append('model-policy/fast', { active: nextActive })
  return {
    kind: 'success',
    text: nextActive ? 'Fast mode enabled for this session.' : 'Fast mode disabled for this session.',
    sourceEventSeq: event.seq,
  }
}

async function requestWithFastMode(
  agent: Agent,
  resolved: ResolvedConfig,
  next: () => Promise<LlmCallConfig>,
): Promise<LlmCallConfig> {
  const config = await next()
  const mode = foldFastMode(agent.session.events)
  if (mode === undefined) return config
  const policy = policyForSelection(resolved, config)
  if (mode && policy?.supportsFast !== true) {
    throw new LlmError(
      'Fast mode is available only for GPT logical models; disable it before selecting another model.',
      'UNSUPPORTED_OPTION',
    )
  }
  if (mode) return { ...config, serviceTier: 'fast' }
  if (policy?.serviceTier !== undefined) return { ...config, serviceTier: 'default' }
  const { serviceTier: _serviceTier, ...withoutTier } = config
  return withoutTier
}

function installFastMode(ctx: Context, resolved: ResolvedConfig): void {
  ctx.effect(() => {
    const disposeRequest = ctx.on('agent/request', ({ agent }, next) =>
      requestWithFastMode(agent, resolved, next))
    const disposeCommand = ctx.commands.register({
      name: 'fast',
      description: 'Enable or disable Fast mode for the current GPT session',
      recordInput: false,
      handler: invocation => fastCommand(invocation, resolved),
    })
    return () => {
      disposeCommand()
      disposeRequest()
    }
  }, 'llm-model-policy: Fast mode')
}

/**
 * Validate physical candidates and register the logical provider route.
 * @param ctx - Cordis context carrying the LLM, commands, and optional attachment/credential services.
 * @param config - schema-resolved logical model policy configuration.
 * @returns a promise that settles after candidate validation and registration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const resolved = resolveConfig(config)
  if (resolved.models.size === 0) {
    throw new Error('model-policy: models must contain at least one logical model')
  }
  const adapterFor = physicalAdapterFor(ctx, resolved)
  const basePhysical = adapterFor(undefined)
  for (const policy of resolved.models.values()) await validatePolicy(policy, basePhysical)
  ctx.llm.registerAdapter(
    [resolved.providerId],
    new ModelPolicyAdapter(resolved, adapterFor),
  )
  installFastMode(ctx, resolved)
}
