# DSH Codex Model Policy

[English](README.md) | 中文

`@deepseek-ai/dsh-codex-model-policy` 是一个可选的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件，面向兼容 Codex 的模型部署。它为 DSH 提供跨多个 pi-ai 物理提供方路由的逻辑模型目录、会话级 GPT Fast 模式，以及与 Web 模型选择器和 composer 共用的已接受模型状态。

本仓库保留完整的 DSH workspace，用于真实 Host/Browser 组合测试。普通使用者通常安装已发布的 npm 包；克隆本仓库主要用于插件开发、打包和集成测试。

## 项目作用

- **逻辑模型路由**：对外提供稳定的逻辑提供方和模型 id，每次请求按顺序选择物理提供方和模型路由。
- **跨提供方故障切换**：在模型内容开始前，遇到限流、服务端、超时、传输或服务等级能力错误时切换到下一个可用路由；已经产生的部分响应不会在另一个提供方上重放。
- **GPT Fast 模式**：声明 `supportsFast: true` 的模型可以显示 Fast 开关。会话状态可持久化，OpenAI 兼容的 pi-ai 请求使用 `service_tier: priority`。
- **共享 Web 选择状态**：`/model` 弹窗和 `conversation.input.model` composer 座位共用每个 session 的目录，因此 Host 接受的提供方、模型、思考档位和 Fast 状态保持一致。
- **能力感知选择**：图片输入和思考档位来自物理候选路由的配置；图片请求会排除纯文本路由。

Host 插件在 DSH 默认 base 组合中保持 opt-in，只有 profile 提供配置后才会启用。Browser 入口由 Web 组合单独加载。本包是插件，不是独立 CLI 或模型服务器。

## 使用条件

- 一个提供 Host `llm` 服务的 DSH 安装；需要 Web 模型选择时还要使用 Web application。
- 当前 DSH 发布线要求 Node.js `^22.19.0` 或 `>=24.0.0`。
- 至少一个 OpenAI 兼容或其他 pi-ai 提供方路由，并通过环境变量引用提供凭据。

插件复用 [`@deepseek-ai/dsh-llm-pi-ai`](packages/llm/llm-pi-ai/README.md) 的提供方协议、凭据解析、思考参数转换、图片转换、回放状态和流式传输。不要在同一个 `ctx.llm` 组合中让其他适配器再次注册本插件使用的物理提供方 id。

## 运行

### 安装与配置

请使用已经在 base/Web 组合中包含此包的 DSH 版本。如果当前 DSH 版本没有包含它，先将包添加到目标 profile。这个包是普通插件而不是 bundle，因此安装本身不会启用它；下面的 profile patch 会启用 Host 行。

```sh
dsh plugin --profile web add @deepseek-ai/dsh-codex-model-policy
```

创建或编辑 `$DSH_HOME/profiles/web/cordis.patch.yml`（`$DSH_HOME` 默认是 `~/.dsh`），用带配置的行替换已禁用的 `codex-model-policy`：

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

在进程环境中设置配置引用的凭据，不要把密钥提交到 `cordis.patch.yml`：

```sh
export AIHUB_API_KEY='replace-with-a-secret'
export BACKUP_API_KEY='replace-with-a-secret'
dsh web
```

PowerShell 使用 `$env:AIHUB_API_KEY = 'replace-with-a-secret'` 和 `$env:BACKUP_API_KEY = 'replace-with-a-secret'`，然后启动 DSH。也可以不启动 Web UI，直接使用 headless profile：

```sh
dsh --profile headless "run a request through the configured logical model"
```

标准 DSH Web bundle 已包含 Browser 行 `codex-model-policy-client`。自定义组合必须从本包加载已配置的 Host 行 `codex-model-policy` 和 Browser 行 `codex-model-policy-client`；将上面示例中的 Host `config` 映射复制到该组合中。

完整 schema、路由规则、动态 settings 行为、API 导出和限制请参阅 [`packages/llm/codex-model-policy/README.md`](packages/llm/codex-model-policy/README.md)。profile 层顺序和插件安装行为请参阅 [DSH 插件安装指南](docs/user/develop/basic/publish.md)。

## Fast 模式与路由规则

逻辑模型只有在 `supportsFast: true` 时才会显示 Fast。选择 Fast 会记录持久化的 `model-policy/fast` session 状态；生效请求头会记录所选服务等级，因此恢复 session 后仍然保留。`fast` 别名会转换为 OpenAI 当前的 `priority` 服务等级；非 OpenAI 兼容路由会拒绝该选项，而不是静默丢弃。

路由按 `priority` 从小到大评估。路由必须满足当前请求的输入模态和思考档位。故障切换只发生在模型内容开始前，以避免部分 assistant 输出重复。切换物理路由可能移除提供方专属的回放元数据，因此不宣称跨提供方复用缓存。

如需把 Fast 设为逻辑模型的默认值，在 `supportsFast: true` 旁增加 `serviceTier: fast`。省略 `serviceTier` 时，模型默认使用提供方普通服务等级，但 Web Fast 开关仍然可用。

## 从源码运行

本仓库包含完整的 DSH workspace。从全新 checkout 运行 Web application：

```sh
git clone https://github.com/UranusNo7/dsh-codex-model-policy.git
cd dsh-codex-model-policy
pnpm install
pnpm run build
pnpm dsh web
```

Web UI 默认运行在 `http://127.0.0.1:3080`。profile 和部署选项请参阅 [DSH Web UI 指南](docs/user/guide/index.md)。

## 开发

运行插件测试并构建可发布的 Host/Browser 产物：

```sh
pnpm exec vitest run packages/llm/codex-model-policy/tests
pnpm --filter @deepseek-ai/dsh-codex-model-policy bundle
```

发布包提供 Host 入口 `lib/index.js` 和 `lib/invariant.js`，Browser 入口 `lib/client.js`，声明文件位于 `lib/types/`。发布前会审计 tarball；源文件和 declaration map 不会进入发布内容。

## 文档

- [插件契约与完整配置](packages/llm/codex-model-policy/README.md)
- [English plugin documentation](packages/llm/codex-model-policy/README.zh.md)
- [DSH 架构](docs/architecture.md)
- [DSH CLI 参考](apps/cli/reference/README.md)
- [插件安装指南](docs/user/develop/basic/publish.md)
- [GitHub 仓库](https://github.com/UranusNo7/dsh-codex-model-policy)

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
