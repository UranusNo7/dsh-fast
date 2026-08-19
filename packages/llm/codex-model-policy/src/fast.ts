/** Durable session state and request-mode folding for GPT-only Fast mode. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Durable session selection for the logical model policy Fast mode. */
    'model-policy/fast': { active: boolean }
  }
}

/**
 * Fold the latest logical model policy Fast selection from a session log.
 * @param events - session events in append order.
 * @returns the latest selection, or `undefined` when the session has no selection.
 */
export function foldFastMode(events: readonly SessionEvent[]): boolean | undefined {
  let active: boolean | undefined
  for (const event of events) {
    if (event.type === 'model-policy/fast') active = event.data.active
  }
  return active
}
