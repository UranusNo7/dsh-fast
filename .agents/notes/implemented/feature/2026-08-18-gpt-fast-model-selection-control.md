# Agent Note: GPT Fast model-selection control

Status: implemented

English | [中文](2026-08-18-gpt-fast-model-selection-control.zh.md)

## Problem

The logical model policy has a durable, session-scoped Fast intent, but Fast needs a discoverable control beside the reasoning choices in the Web model selector. Slash-command registration would split a model capability between the command catalog and the model-selection UI, while React-local state would not survive reloads or resume.

## Decision

The logical model policy provides an optional `modelPolicy` controller with `getFast()` and `setFast()` operations. The Host `session.models` response carries optional `{ active, available }` state, and its model catalog carries optional `supportsFast` metadata. `session.selectModel` accepts an optional `fast` value and delegates it to the controller; profiles without the policy keep the existing wire fields.

`ModelDirectory` owns Fast state beside the current `ModelSelection`, so the `/model` contribution and composer share one session store. The composer renders Fast below the adapter-provided reasoning choices as a `menuitemcheckbox` with a switch treatment. It renders the control when the selected logical model supports Fast or when an active mode must be disabled; an unsupported active mode remains turn-off-able. The toggle submits through `session.selectModel`, and the UI publishes the Host response only after the request succeeds.

The controller remains the owner of the durable `model-policy/fast` event. The existing request middleware folds that event and applies `serviceTier: 'fast'` only to GPT-capable logical models; `dsh-llm-pi-ai` owns the OpenAI `service_tier: priority` spelling. The policy no longer registers a slash command.

## Testing

The policy tests cover controller commits, GPT-only rejection, durable request headers, and Loader composition. Host API tests cover optional Fast state round-trips. Browser composition tests cover shared-directory toggle wiring, and `ModelSelect` tests cover the GPT-only control, checked-state update, unsupported-model omission, and unchanged reasoning choices.

## Alternatives considered

- **Keep `/fast` as the user-facing switch** — rejected because Fast is a capability of the selected logical model and belongs beside model reasoning choices; the policy still owns the same durable event and request behavior without exposing command registration.
- **Keep Fast in React component state** — rejected because the `/model` popup and composer would diverge, and reload or resume would lose the Host-authoritative session state.
- **Add a separate Fast RPC** — rejected because the existing `session.selectModel` commit already serializes model and Fast changes through the Host's session-selection path and returns one accepted state.
- **Hide an active Fast mode on an unsupported model** — rejected because the session would have no UI recovery path; the active control remains available to disable the unsafe preference.

## Consequences

- Fast is visible only when the optional model-policy controller and the selected model's capability make it meaningful; profiles without the policy remain unchanged.
- Fast changes are session-local and durable through `model-policy/fast`, while the model catalog and UI carry only optional projections of the state.
- The model-selection package depends on no policy runtime package; it consumes structural Host API fields and the injected controller result.
- User-facing Fast switching is no longer part of the slash-command catalog, so command clients must use the model-selection control when that UI is available.

## Related

- [Session-scoped GPT Fast mode](../architecture/2026-08-17-gpt-fast-session-mode.md) owns durable Fast intent, GPT capability gating, and request-header application.
- [Logical cross-provider model policy routing](../architecture/2026-08-17-logical-model-policy-routing.md) owns logical provider routes and capability metadata.
- [Web session model selector](2026-07-24-web-session-model-selector.md) owns the shared model-selection directory and Host selection semantics.
