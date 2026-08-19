# Agent Note: Session-scoped GPT Fast mode

Status: implemented

English | [中文](2026-08-17-gpt-fast-session-mode.zh.md)

## Problem

The logical model policy needs an opt-in Fast mode that applies to later requests in one agent session, survives resume, and is valid only for logical GPT models. A process variable or a static provider profile cannot reconstruct that choice from the session log or keep it isolated from other logical models.

## Decision

`@deepseek-ai/dsh-codex-model-policy` provides an optional `modelPolicy` controller for the Host model-selection API. The controller appends `model-policy/fast: { active }` only after an accepted session-level toggle, reports whether the selected logical model supports Fast, and enables it only when that model declares `supportsFast: true`; this is an explicit capability rather than a model-id naming rule. The user-facing control is the Web model selector's Fast switch, not a slash command.

The package listens on the global `agent/request` waterfall and calls `next()` before applying the folded session state. Active Fast adds `serviceTier: 'fast'` to the effective logical call configuration. An active mode on a model without `supportsFast` fails with `UNSUPPORTED_OPTION`; disabling the mode remains available so a session can recover after model selection changes. The inactive state removes a request-level tier override, or supplies `default` when it must suppress a configured logical default tier.

`LlmServiceTier` is provider-neutral in `GenerateOptions` and `LlmCallConfig`, so the effective service tier is frozen and recorded in the existing `request/header` snapshot with the other model-visible request fields. `dsh-llm-pi-ai` maps `fast` to OpenAI-compatible `service_tier: priority` and rejects unsupported protocols before credential or provider I/O. The session event is the source of Fast intent; the request header is the effective request snapshot.

## Testing

Package tests cover controller commits, durable event folding, GPT-only rejection, request-level tier selection, Fast wire mapping, and plugin disposal. A real Loader composition mounts sessions, credentials, LLM, and the logical policy from a test-only `cordis.yml`; it calls the controller, dispatches `agent/request`, and verifies the effective tier before a local mock provider request. Host API tests and the browser model-selection tests cover the optional state and shared Fast switch, while the loop integration records Fast and its removal in successive `request/header` events.

## Alternatives considered

- **Keep Fast in a process or agent object variable** — rejected because resume and a second process could not reconstruct the mode from the durable session log.
- **Infer GPT support from a model-id prefix** — rejected because logical ids are deployment-owned aliases; `supportsFast` makes the capability explicit and reviewable.
- **Store only an effective header change** — rejected because the durable event must retain the session intent independently of the selected model, while the header remains the per-request snapshot.
- **Mutate a provider profile or add Fast to the loop core** — rejected because profiles are shared immutable route inputs and the optional logical policy must not impose a GPT-specific mode on every provider.
- **Map `fast` in the logical policy adapter** — rejected because pi-ai owns OpenAI protocol spelling and unsupported-protocol validation; the provider-neutral option keeps that wire mapping in one adapter.

## Consequences

- Fast is session-local, durable across resume, and visible to the next model request without adding prompt text.
- A logical model must opt in with `supportsFast: true`; non-GPT models cannot accidentally receive the priority tier through the model-selection controller.
- The core LLM call vocabulary gains one provider-neutral service-tier field, while each adapter remains responsible for support and wire conversion.
- A session with Fast active must disable it before selecting a logical model that does not support Fast; request middleware rejects the unsafe combination instead of silently dropping the preference.

## Related

- [Logical cross-provider model policy routing](2026-08-17-logical-model-policy-routing.md) owns the logical provider, route ordering, capability filtering, and pre-output failover.
- [GPT Fast model-selection control](../feature/2026-08-18-gpt-fast-model-selection-control.md) owns the Host API and Web UI bridge for the session-level switch.
- [Reconstructable requests](2026-07-05-reconstructable-requests.md) owns the request-header rule that makes effective model-visible configuration durable.
- [Provider-routed LLM adapters](2026-07-14-provider-routed-llm-adapters.md) owns physical provider route ownership and pi-ai replay conversion.
