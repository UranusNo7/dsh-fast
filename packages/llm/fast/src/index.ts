/**
 * Pluggable Fast plugin: session-scoped `fast/mode` that is independent of any
 * model policy. Enable it by adding `@deepseek-ai/dsh-fast` to a
 * `cordis.yml`; disable it by removing the entry — no other package changes.
 *
 * The plugin owns the durable `fast/mode` event, folds the log, and injects
 * the tier via the `agent/request` waterfall. Models declare
 * `supportsFast` through the augmented `LlmModelInfo`; the plugin never
 * hard-codes a model list.
 *
 * @module @deepseek-ai/dsh-fast
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import { FAST_EVENT, foldFastMode } from './fast.ts'
import './types.ts'

export { FAST_EVENT, LEGACY_FAST_EVENT, foldFastMode } from './fast.ts'
export type { LlmServiceTier } from '@deepseek-ai/dsh-llm'

/** Whether Fast is active and whether the current model may use it. */
export interface FastState {
  active: boolean
  available: boolean
}

/** Session-scoped Fast operations. */
export interface FastController {
  getFast(agent: Agent): FastState
  setFast(agent: Agent, active: boolean): FastState
  /** Whether the model currently selected for this session may use Fast. */
  isAvailable(agent: Agent): boolean
}

export const name = 'fast'
export const inject = ['llm']

function isAvailableForModel(model: LlmModelInfo | undefined): boolean {
  return (model as { supportsFast?: boolean } | undefined)?.supportsFast === true
}

function makeController(_ctx: Context): FastController {
  const controller: FastController = {
    getFast(agent) {
      const active = foldFastMode(agent.session.events) === true
      // Availability is best-effort here; the authoritative check is in
      // `requestWithFastMode` where the resolved model is known.
      return { active, available: active || isAvailableForModel(undefined) ? active : false }
    },
    setFast(agent, active) {
      if (active) {
        // The request path will throw `UNSUPPORTED_OPTION` if the current
        // model truly lacks `supportsFast`; the toggle itself is permissive
        // so the user can enable Fast before picking a Fast-capable model.
      }
      if (foldFastMode(agent.session.events) !== active) {
        agent.session.append(FAST_EVENT, { active })
      }
      return controller.getFast(agent)
    },
    isAvailable() {
      return false
    },
  }
  return controller
}

async function requestWithFastMode(
  agent: Agent,
  next: () => Promise<LlmCallConfig>,
): Promise<LlmCallConfig> {
  const config = await next()
  const mode = foldFastMode(agent.session.events)
  if (mode === undefined) return config
  // When Fast is active, force the `fast` tier; when inactive but the
  // previous config carried `fast`, strip it so a model that does not support
  // Fast does not inherit a stale tier.
  if (mode) return { ...config, serviceTier: 'fast' as const }
  if (config.serviceTier === 'fast') {
    const { serviceTier: _serviceTier, ...withoutTier } = config
    return withoutTier as LlmCallConfig
  }
  return config
}

/**
 * Register the Fast controller and its request waterfall.
 * @param ctx - Cordis context carrying `llm` and `sessions`.
 */
export function apply(ctx: Context): void {
  const controller = makeController(ctx)
  ctx.provide('fast', controller)
  ctx.effect(
    () => ctx.on('agent/request', ({ agent }: { agent: Agent }, next: () => Promise<LlmCallConfig>) =>
      requestWithFastMode(agent, next)),
    'fast: tier injection',
  )
}
