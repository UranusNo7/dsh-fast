# DSH Codex Model Policy

English | [中文](README.zh.md)

`@deepseek-ai/dsh-codex-model-policy` is an optional [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin for Codex-compatible model deployments. It gives DSH one logical model directory over multiple physical pi-ai provider routes, adds session-level GPT Fast mode, and connects the same accepted model state to the Web model picker and composer.

This repository is maintained in a full DSH workspace so the plugin can be tested against real Host and Browser composition. End users normally install the published package; cloning this repository is for plugin development, packaging, and integration tests.

## What it provides

- **Logical model routing** — expose stable logical provider and model ids while selecting an ordered physical provider/model route for each request.
- **Cross-provider failover** — move to the next eligible route for rate-limit, server, timeout, transport, or service-tier capability failures before model content starts; a partially emitted response is never replayed on another provider.
- **GPT Fast mode** — models with `supportsFast: true` can expose the Fast switch. The session state is durable, and OpenAI-compatible pi-ai requests use `service_tier: priority`.
- **Shared Web selection** — the `/model` popup and `conversation.input.model` composer seat use one per-session directory, so the Host-accepted provider, model, reasoning effort, and Fast state stay aligned.
- **Capability-aware selection** — image input and reasoning efforts are advertised from the configured physical candidates. Text-only routes are excluded from image requests.

The Host plugin is opt-in and remains disabled in the default DSH base composition until a profile supplies its configuration. The Browser face is loaded separately by the Web composition. This package is a plugin, not a standalone CLI or model server.

## Requirements

- A DSH installation with the Host `llm` service and the Web application when Browser model selection is required.
- Node.js `^22.19.0` or `>=24.0.0` for the current DSH release line.
- One or more OpenAI-compatible or other pi-ai provider routes with credentials supplied through environment-variable references.

The plugin reuses [`@deepseek-ai/dsh-llm-pi-ai`](packages/llm/llm-pi-ai/README.md) for provider protocols, credentials, reasoning conversion, image conversion, replay state, and streaming. Do not register the same physical provider ids in another `ctx.llm` adapter in the same composition.

## Run

### Install and configure

Use a DSH release that includes this package in its base/Web composition. If the installed DSH release does not include it, add the package to the target profile first. The package is an ordinary plugin rather than a bundle, so installation alone does not enable it; the profile patch below activates the Host row.

```sh
dsh plugin --profile web add @deepseek-ai/dsh-codex-model-policy
```

Create or edit `$DSH_HOME/profiles/web/cordis.patch.yml` (`$DSH_HOME` defaults to `~/.dsh`) and replace the disabled `codex-model-policy` row with a configured row:

```yaml
- id: codex-model-policy
  config:
    providerId: gpt-policy
    displayName: GPT Policy
    providers:
      primary:
        apiKeyEnv: AIHUB_API_KEY
        api: openai-responses
        baseURL: https://aihub.example/v1
        models:
          - id: gpt-5.6
            name: GPT-5.6
            contextWindow: 262144
            maxTokens: 128000
            input: [text, image]
            reasoningEfforts:
              off:
              low: low
              medium: medium
              high: high
      backup:
        apiKeyEnv: BACKUP_API_KEY
        api: openai-responses
        baseURL: https://backup.example/v1
        models:
          - id: gpt-5.6
            name: GPT-5.6 Backup
            contextWindow: 131072
            maxTokens: 65536
            input: [text]
            reasoningEfforts:
              off:
              high: high
    models:
      gpt-5.6:
        maxTokens: 128000
        input: [text, image]
        reasoning:
          default: high
          allowed: [off, low, medium, high]
        supportsFast: true
        routes:
          - provider: primary
            model: gpt-5.6
            priority: 10
          - provider: backup
            model: gpt-5.6
            priority: 20
```

Set the referenced credentials in the process environment; never commit them to `cordis.patch.yml`:

```sh
export AIHUB_API_KEY='replace-with-a-secret'
export BACKUP_API_KEY='replace-with-a-secret'
dsh web
```

On PowerShell, use `$env:AIHUB_API_KEY = 'replace-with-a-secret'` and `$env:BACKUP_API_KEY = 'replace-with-a-secret'` before starting DSH. The profile can also be used without the Web UI:

```sh
dsh --profile headless "run a request through the configured logical model"
```

The Web profile already contains the Browser row `codex-model-policy-client` in the standard DSH Web bundle. A custom composition must load both the configured Host row `codex-model-policy` and the Browser row `codex-model-policy-client` from this package; copy the Host `config` mapping shown above into that composition.

For the full schema, route rules, dynamic settings behavior, API exports, and limitations, see [`packages/llm/codex-model-policy/README.md`](packages/llm/codex-model-policy/README.md). For profile layer order and plugin installation behavior, see the [DSH plugin installation guide](docs/user/develop/basic/publish.md).

## Fast mode and routing semantics

A logical model advertises Fast only when `supportsFast: true`. Selecting Fast records durable `model-policy/fast` session state; the effective request header records the selected service tier so resumed sessions retain the mode. The `fast` alias is translated to OpenAI's current `priority` service tier, and non-OpenAI-compatible routes reject that option instead of silently dropping it.

Routes are evaluated by ascending `priority`. A route must be eligible for the request's input modalities and reasoning effort. Failover is limited to failures before model content begins, which prevents duplicated partial assistant output. Switching physical routes can remove provider-specific replay metadata, so cross-provider cache reuse is not claimed.

To make Fast the configured default for a logical model, add `serviceTier: fast` beside `supportsFast: true`. Omitting `serviceTier` starts with the provider's normal tier while still allowing the Web Fast switch.

## Run from source

This repository contains the full DSH workspace. To run its Web application from a fresh checkout:

```sh
git clone https://github.com/UranusNo7/dsh-codex-model-policy.git
cd dsh-codex-model-policy
pnpm install
pnpm run build
pnpm dsh web
```

The Web UI is served at `http://127.0.0.1:3080` by default. See the [DSH Web UI guide](docs/user/guide/index.md) for profile and deployment options.

## Development

Run the focused plugin tests and build the publishable Host/Browser artifacts:

```sh
pnpm exec vitest run packages/llm/codex-model-policy/tests
pnpm --filter @deepseek-ai/dsh-codex-model-policy bundle
```

The package publishes Host exports from `lib/index.js` and `lib/invariant.js`, the Browser export from `lib/client.js`, and declarations under `lib/types/`. The package tarball is audited before release; source files and declaration maps are not part of the publication payload.

## Documentation

- [Plugin contract and full configuration](packages/llm/codex-model-policy/README.md)
- [Chinese plugin documentation](packages/llm/codex-model-policy/README.zh.md)
- [DSH architecture](docs/architecture.md)
- [DSH CLI reference](apps/cli/reference/README.md)
- [Plugin installation guide](docs/user/develop/basic/publish.md)
- [GitHub repository](https://github.com/UranusNo7/dsh-codex-model-policy)

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
