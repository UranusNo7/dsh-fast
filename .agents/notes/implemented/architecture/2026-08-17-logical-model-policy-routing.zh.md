# Agent Note: 跨提供方逻辑模型策略路由

Status: implemented

[English](2026-08-17-logical-model-policy-routing.md) | 中文

## 问题

LLM seam 暴露的是物理 `provider` 和 `model` 路由，但部署可能需要跨网关保持一个稳定的逻辑模型名、统一输出上限和思考词汇、显式 Fast 等级、按能力筛选图片路由，以及有序的故障恢复候选。把这些规则加入 `LlmRuntime` 或已发布的提供方，会把可选的部署策略变成核心 seam 的一部分，也会重复 pi-ai 的 wire 转换。

## 决策

### 使用可选的逻辑提供方插件

`@deepseek-ai/dsh-llm-model-policy` 通过 `ctx.llm.registerAdapter()` 注册一个逻辑提供方。它的配置拥有逻辑模型 id 和有序 `{ provider, model }` 候选路由，同时复用 `dsh-llm-pi-ai` 公开的 profile schema 和凭据解析器。该包不由已发布的默认组合挂载；组合只有在显式挂载插件并选择逻辑提供方和模型时才启用它。

逻辑适配器返回精确的逻辑模型元数据。上下文窗口使用配置的逻辑值，或候选路由中已声明的最小窗口；输出上限使用逻辑 `maxTokens`。物理适配器仍负责提供方 catalog 解析、协议转换、凭据、附件、响应转换和流生命周期。

### 把统一策略保持在逻辑模型上

逻辑模型声明 `input`、`maxTokens`、`reasoning.allowed`、`reasoning.default`、可选默认 `serviceTier`、显式 `supportsFast` 能力和有序路由。配置会拒绝重复物理候选，以及不在逻辑允许列表中的默认思考档位。加载期验证要求每个声明的图片能力或非 off 思考能力至少存在于一个物理候选；请求期还会针对实际图片和思考请求再次筛选候选。会话级 Fast 语义记录在 [GPT 会话级 Fast 模式](2026-08-17-gpt-fast-session-mode.md) 中。

配置的 `serviceTier: fast` 或会话级 `fast` 覆盖会在复用的 pi-ai 适配器中映射为 `service_tier: priority`。其他支持的等级会发送到 OpenAI 兼容的 pi-ai API；不兼容的协议会以 `UNSUPPORTED_OPTION` 失败，而不是丢弃字段。这个 wire 专用映射留在 `dsh-llm-pi-ai`，由它为组合导出 profile schema、profile 解析器、service-tier 词汇和按请求解析的凭据解析器。

### 在路由之间保持回放和图片安全

物理分发前，只有当 assistant 回放状态属于同一路由时，才会把它的 provenance 改写为选中的物理提供方和模型。切换路由时保留已记录的内容，但移除其他提供方的回放元数据，避免一个提供方的响应签名被发送给另一个提供方的转换器。只有在配置声明且精确模型元数据包含 `image` 时，逻辑图片输入才会发布和准入。

### 只在模型内容之前故障切换

逻辑适配器会缓冲非内容分片；只有在尚未产生任何模型块且出现限流、服务端、超时、传输或 service-tier 能力错误时，才重试下一个符合条件的候选。模型块开始后，适配器继续产生当前路由的终止结果，不会在另一个提供方上拼接或重放部分输出。基础 `dsh-llm` stream 和 `dsh-llm-retry` 策略仍是单物理路由机制；这个可选适配器单独拥有前置候选选择。

## 测试

包测试覆盖逻辑元数据、思考能力交集、图片能力筛选、内容前故障切换、安全的回放请求映射、GPT-only Fast 命令、持久化 request-header 变化和插件释放。真实 Loader 组合会启动测试专用 `cordis.yml`，挂载 sessions 和 commands，执行 `/fast`，验证 request middleware 和 Fast wire 字段，并在两个本地 mock 网关之间执行故障切换。pi-ai 适配器测试覆盖公开 profile 导出，以及 OpenAI 兼容请求路径上的静态和请求级 Fast 映射。

## 考虑过的替代方案

- **把逻辑模型和故障切换放进 `LlmRuntime`**——不予采纳，因为核心 seam 应保持物理路由所有权，并且在没有部署专用策略或 pi-ai 的情况下仍应可用。
- **在核心 LLM runtime 中映射提供方无关的 service tier**——不予采纳，因为核心只承载提供方无关的 `LlmServiceTier` 值；协议拼写和不支持协议校验仍由 pi-ai 适配器负责，逻辑策略拥有 session 能力决策。
- **使用 `agent/request-error` 执行候选故障切换**——不予采纳，因为该策略必须在部分输出暴露之前做决定，而 agent 恢复拥有持久化失败步骤和后续轮次。内容产生后重试需要一个没有安全消费方的响应拼接协议。
- **合并所有候选的图片和思考能力**——不予采纳，因为逻辑 catalog 会高估选中的物理模型无法提供的能力。只有配置和候选元数据共同支持时，逻辑能力才会保留。
- **修改被冻结的 `llm/stream` 请求来切换候选**——不予采纳，因为请求对象可能被冻结，路由选择应当在适配器分离出的物理请求副本中完成。

## 后果

- 部署可以在不修改核心 LLM runtime 的情况下更换物理提供方、端点、凭据、上限、思考方言、服务等级和候选顺序。
- 逻辑模型 id 成为稳定的选择键，但插件仍需显式 opt-in，不增加 Web 设置编辑器，也不加入已发布默认值。
- 故障切换避免重复部分输出，但内容开始后不再恢复；图片和思考准入依赖准确的物理路由元数据。
- 策略包依赖 pi-ai 适配器公开的 profile 和凭据 seam，因此共享协议转换仍由 pi-ai 单独实现，而不会复制到策略插件。
- 保守的逻辑上下文窗口在候选容量不同的情况下可能更早触发压缩，但不会高估路由容量。

## 相关记录

- [提供方路由 LLM 适配器](2026-07-14-provider-routed-llm-adapters.md)拥有物理提供方所有权和 pi-ai 回放转换。
- [LLM 模型 catalog 与 ACP 选择](2026-07-15-llm-model-catalog-and-acp-selection.md)拥有建议性 catalog 行为；本插件增加显式逻辑 catalog，但不把物理发现变成权威来源。
- [路由模型上下文与压缩策略](2026-07-20-routed-model-context-and-compaction-policy.md)拥有精确路由上下文元数据和可选压缩策略。
- [请求级 LLM 配置凭据](2026-07-29-request-level-llm-config-credentials.md)拥有物理 profile 复用的按请求凭据引用。
- [pi-ai 路由默认输入模态](2026-08-12-pi-ai-route-default-input-modalities.md)拥有显式物理输入能力声明。
- [有界 LLM 请求恢复](2026-06-21-bounded-llm-request-recovery.md)仍是同一路由 agent 恢复的权威记录；本记录为逻辑适配器增加内容前候选选择这一独立例外。
- [GPT 会话级 Fast 模式](2026-08-17-gpt-fast-session-mode.md)拥有持久化 Fast 意图、GPT 能力限制和 request-header 应用。
