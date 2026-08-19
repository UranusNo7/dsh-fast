/** Logical cross-provider model policy plugin for DSH. */

import type { Context } from '@deepseek-ai/cordis'
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

/** Provider/model pair used by the Host model-selection bridge. */
export interface ModelPolicySelection {
  provider: string
  model: string
}

/** Fast-mode state returned to model-selection clients. */
export interface ModelPolicyFastState {
  active: boolean
  available: boolean
}

/** Session-scoped Fast operations exposed to the Host model-selection API. */
export interface ModelPolicySessionController {
  getFast(agent: Agent, selection: ModelPolicySelection): ModelPolicyFastState
  setFast(agent: Agent, selection: ModelPolicySelection, active: boolean): ModelPolicyFastState
}

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

export const name = 'codex-model-policy'
export const inject = ['llm']

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

function policyForSelection(
  resolved: ResolvedConfig,
  selection: ModelPolicySelection,
): ResolvedModelPolicy | undefined {
  if (selection.provider === resolved.providerId) {
    return resolved.models.get(selection.model)
  }
  for (const policy of resolved.models.values()) {
    if (policy.routes.some(route => route.provider === selection.provider && route.model === selection.model)) {
      return policy
    }
  }
  return undefined
}

function fastState(
  agent: Agent,
  resolved: ResolvedConfig,
  selection: ModelPolicySelection,
): ModelPolicyFastState {
  return {
    active: foldFastMode(agent.session.events) === true,
    available: policyForSelection(resolved, selection)?.supportsFast === true,
  }
}

function setFast(
  agent: Agent,
  resolved: ResolvedConfig,
  selection: ModelPolicySelection,
  active: boolean,
): ModelPolicyFastState {
  if (active && policyForSelection(resolved, selection)?.supportsFast !== true) {
    throw new LlmError(
      'Fast mode is available only for GPT logical models.',
      'UNSUPPORTED_OPTION',
    )
  }
  if (foldFastMode(agent.session.events) !== active) {
    agent.session.append('model-policy/fast', { active })
  }
  return fastState(agent, resolved, selection)
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
  const controller: ModelPolicySessionController = {
    getFast: (agent, selection) => fastState(agent, resolved, selection),
    setFast: (agent, selection, active) => setFast(agent, resolved, selection, active),
  }
  ctx.provide('modelPolicy', controller)
  ctx.effect(() => ctx.on('agent/request', ({ agent }, next) =>
    requestWithFastMode(agent, resolved, next)), 'codex-model-policy: Fast mode')
}

/**
 * Validate physical candidates and register the logical provider route.
 * @param ctx - Cordis context carrying the LLM and optional attachment/credential services.
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
