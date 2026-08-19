# Agent Note: Logical cross-provider model policy routing

Status: implemented

English | [中文](2026-08-17-logical-model-policy-routing.zh.md)

## Problem

The LLM seam exposes physical `provider` and `model` routes, while deployments may need one stable logical model name across gateways, a common output cap and reasoning vocabulary, an explicit Fast tier, capability-aware image routing, and ordered recovery candidates. Adding those rules to `LlmRuntime` or to a shipped provider would make optional deployment policy part of the core seam and would duplicate pi-ai wire conversion.

## Decision

### Use an opt-in logical provider plugin

`@deepseek-ai/dsh-codex-model-policy` registers one logical provider through `ctx.llm.registerAdapter()`. Its configuration owns logical model ids and ordered `{ provider, model }` candidates, while its nested physical profiles reuse the public profile schema and credential resolver from `dsh-llm-pi-ai`. The package is not mounted by shipped defaults; a composition opts in by mounting the plugin and selecting its logical provider and model.

The logical adapter returns exact logical model metadata. Its context window is the configured logical value or the smallest declared candidate window, and its output cap is the logical `maxTokens` value. The physical adapter remains responsible for provider catalog resolution, protocol conversion, credentials, attachments, response conversion, and stream lifecycle.

### Keep unified policy at the logical model

A logical model declares `input`, `maxTokens`, `reasoning.allowed`, `reasoning.default`, an optional default `serviceTier`, explicit `supportsFast` capability, and ordered routes. Configuration rejects duplicate physical candidates and a default reasoning level outside the logical allowed list. Load-time validation requires every declared image or non-off reasoning capability to exist on at least one physical candidate; request-time selection filters candidates again for the actual image and reasoning request. Session-level Fast semantics are recorded in the [GPT Fast mode note](2026-08-17-gpt-fast-session-mode.md).

A configured `serviceTier: fast` or the session-level `fast` override maps to `service_tier: priority` in the reused pi-ai adapter. Other supported tier values are sent to OpenAI-compatible pi-ai APIs, while an incompatible protocol fails with `UNSUPPORTED_OPTION` rather than dropping the field. This wire-specific mapping stays in `dsh-llm-pi-ai`, which exports the profile schema, profile resolver, service-tier vocabulary, and per-request credential resolver for composition.

### Preserve replay and image safety across routes

Before a physical dispatch, assistant replay provenance is rewritten to the selected physical provider and model only when the replay state belongs to that same route. A route switch keeps the recorded content but removes foreign provider replay metadata, preventing one provider's response signatures from being sent to another provider's converter. Logical image input is advertised only when configured and is admitted only on candidates whose exact model metadata includes `image`.

### Fail over only before model content

The logical adapter buffers non-content chunks and retries the next eligible candidate only for retryable rate-limit, server, timeout, transport, or service-tier capability failures before any model block is emitted. Once a model block starts, the adapter yields the current route's terminal result and never splices or replays partial output on another provider. The base `dsh-llm` stream and `dsh-llm-retry` policy remain single-physical-route mechanisms; this optional adapter owns its own pre-output candidate selection.

## Testing

Package tests cover logical metadata, reasoning intersection, image-capability filtering, pre-output failover, replay-safe request mapping, GPT-only Fast controller commits, durable request-header changes, and plugin disposal. A real Loader composition boots a test-only `cordis.yml`, mounts sessions and credentials, calls the Fast controller, verifies the request middleware and Fast wire field, and exercises failover between two local mock gateways. The pi-ai adapter tests cover the public profile exports and both static and request-level Fast mapping on its OpenAI-compatible request path; the Host and browser model-selection tests cover the optional catalog state and switch bridge.

## Alternatives considered

- **Put logical models and failover in `LlmRuntime`** — rejected because the core seam should retain physical route ownership and remain useful without deployment-specific policy or pi-ai.
- **Map provider-neutral service tiers in the core LLM runtime** — rejected because the core carries only the provider-neutral `LlmServiceTier` value; protocol spelling and unsupported-protocol validation remain in the pi-ai adapter, while the logical policy owns the session capability decision.
- **Use `agent/request-error` for candidate failover** — rejected because this policy must decide before partial output can be exposed, while agent recovery owns durable failed steps and later turns. Retrying after content would require a response-splicing protocol that has no safe consumer.
- **Union every candidate's image and reasoning capabilities** — rejected because the logical catalog would overclaim a route that the selected physical model cannot serve. A logical capability is retained only when configuration and candidate metadata justify it.
- **Mutate the frozen `llm/stream` request to switch candidates** — rejected because request objects can be deep-frozen and route choice belongs to the adapter's detached physical request copy.

## Consequences

- Deployments can change physical providers, endpoints, credentials, caps, reasoning dialects, service tiers, and fallback order without changing the core LLM runtime.
- Logical model ids are stable selection keys, but the plugin remains an explicit opt-in and does not add a Web settings editor or shipped defaults.
- Failover avoids duplicate partial output but does not recover after content starts; physical route metadata must be accurate for image and reasoning admission.
- The policy package depends on the pi-ai adapter's public profile and credential seams, so pi-ai's shared protocol conversion remains one implementation instead of being copied into the policy plugin.
- The conservative logical context window may trigger earlier compaction when candidate capacities differ; it does not overstate a route's capacity.

## Related

- [Provider-routed LLM adapters](2026-07-14-provider-routed-llm-adapters.md) owns physical provider ownership and pi-ai replay conversion.
- [LLM model catalog and ACP selection](2026-07-15-llm-model-catalog-and-acp-selection.md) owns advisory catalog behavior; this plugin adds an explicit logical catalog without making physical discovery authoritative.
- [Routed model context and compaction policy](2026-07-20-routed-model-context-and-compaction-policy.md) owns exact-route context metadata and optional compaction policy.
- [Request-level LLM config credentials](2026-07-29-request-level-llm-config-credentials.md) owns per-request credential references reused by the physical profiles.
- [Pi-ai route default input modalities](2026-08-12-pi-ai-route-default-input-modalities.md) owns explicit physical input capability declarations.
- [Bounded recovery for transient LLM request failures](2026-06-21-bounded-llm-request-recovery.md) remains authoritative for same-route agent recovery; this note adds the separate logical adapter exception for pre-output candidate selection.
- [Session-scoped GPT Fast mode](2026-08-17-gpt-fast-session-mode.md) owns durable Fast intent, GPT capability gating, and request-header application.
