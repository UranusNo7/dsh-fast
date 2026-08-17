/** Logical cross-provider model policy plugin for DSH. */

import type { Context } from '@deepseek-ai/cordis'
import {
  LlmError,
} from '@deepseek-ai/dsh-llm'
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

export const name = 'llm-model-policy'
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
}
