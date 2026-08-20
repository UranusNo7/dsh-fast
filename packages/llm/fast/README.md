# @deepseek-ai/dsh-fast

English | [中文](README.zh.md)

Pluggable Fast service-tier for DeepSeek Harness. Enable it in any `cordis.yml` with `@deepseek-ai/dsh-fast` — remove the row to disable it, no other package changes.

## What it does

* Owns the durable `fast/mode` event (legacy `model-policy/fast` is folded identically) and the `FastController` (`ctx.fast`).
* Augments `LlmServiceTierMap` with `fast` and `LlmModelInfo` with `supportsFast` via declaration merging — the core `dsh-llm` never hard-codes Fast.
* Injects `serviceTier: 'fast'` on every `agent/request` when `foldFastMode(session.events) === true`, and strips a stale `fast` tier when the mode is off.

Models declare `supportsFast: true` through their adapter's `LlmModelInfo`; the plugin never hard-codes a model list. The request path still enforces `supportsFast` through the model-policy plugin when that plugin is present.

## Human command

When `ctx.commands` is composed, the plugin registers `/fast [on|off|status]` (bare `/fast` toggles). The command appends `fast/mode` and reports the result without a model turn.

```sh
/fast        # toggle
/fast on     # enable
/fast off    # disable
/fast status # show
```

The UI toggle in `dsh-codex-model-policy` remains the primary surface; the command is the non-UI alternative that the desktop AI can also drive.

## Composition

```yaml
- id: fast
  name: '@deepseek-ai/dsh-fast'
```

No config. The plugin is host-only and has no client half.

## Known Limitations and Deferred Work

UI for Fast is currently owned by `dsh-codex-model-policy`; a future standalone Fast UI could be split out.
