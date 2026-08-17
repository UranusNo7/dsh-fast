# Agent Note: GPT 会话级 Fast 模式

Status: implemented

[English](2026-08-17-gpt-fast-session-mode.md) | 中文

## 问题

逻辑模型策略需要一个可选的 Fast 模式，使它作用于同一 agent session 的后续请求、在恢复 session 后仍然存在，并且只对逻辑 GPT 模型有效。进程变量或静态提供方 profile 无法从 session log 重建选择，也无法把它与其他逻辑模型隔离。

## 决策

`@deepseek-ai/dsh-llm-model-policy` 通过 `@deepseek-ai/dsh-commands` 注册 `/fast`、`/fast off` 和 `/fast status`。`/fast` 追加 `model-policy/fast: { active: true }`，`/fast off` 追加对应的 false 事件，`/fast status` 折叠最新事件但不改变日志。只有当前逻辑模型声明 `supportsFast: true` 时命令才会启用 Fast；这是显式能力，而不是模型 id 命名规则。

包在全局 `agent/request` waterfall 上监听，并在应用 session 状态前调用 `next()`。Fast 激活时，会在生效的逻辑调用配置上增加 `serviceTier: 'fast'`。如果 Fast 已激活但模型没有 `supportsFast`，请求以 `UNSUPPORTED_OPTION` 失败；禁用 Fast 始终可用，因此模型选择改变后 session 仍可恢复。非激活状态会移除请求级 service tier 覆盖；如果逻辑模型配置了静态默认等级，则使用 `default` 抑制该请求的静态等级。

`LlmServiceTier` 在 `GenerateOptions` 和 `LlmCallConfig` 中是提供方无关的类型，因此生效服务等级会与其他模型可见请求字段一起冻结并记录在现有 `request/header` 快照中。`dsh-llm-pi-ai` 把 `fast` 映射为 OpenAI 兼容协议的 `service_tier: priority`，并在凭据或提供方 I/O 前拒绝不支持的协议。session 事件是 Fast 意图的来源；request header 是生效请求快照。

## 测试

包测试覆盖命令解析、持久化事件折叠、GPT-only 拒绝、请求级 service tier 选择、Fast wire 映射和插件释放。真实 Loader 组合从测试专用 `cordis.yml` 挂载 sessions、commands、credentials、LLM 和逻辑策略；它执行 `/fast`、分发 `agent/request`，并在本地 mock 提供方请求前验证生效等级。loop 集成测试在连续的 `request/header` 事件中记录 Fast 及其移除。

## 考虑过的替代方案

- **把 Fast 保存在进程变量或 Agent 对象字段中**——不予采纳，因为恢复 session 或第二个进程无法从持久化 session log 重建模式。
- **通过模型 id 前缀推断 GPT 支持**——不予采纳，因为逻辑 id 由部署定义别名；`supportsFast` 使能力显式且可审查。
- **只记录生效的 header 变化**——不予采纳，因为持久化事件需要独立保留 session 意图，而 header 仍然只是每次请求的快照。
- **修改提供方 profile 或把 Fast 加入 loop 核心**——不予采纳，因为 profile 是共享的不可变路由输入，可选逻辑策略也不应让所有提供方承担 GPT 专用模式。
- **在逻辑策略适配器中映射 `fast`**——不予采纳，因为 pi-ai 拥有 OpenAI 协议拼写和不支持协议校验；提供方无关选项让 wire 映射保持在一个适配器中。

## 后果

- Fast 只属于当前 session，可在恢复后继续使用，并在不增加提示词文本的情况下影响下一次模型请求。
- 逻辑模型必须用 `supportsFast: true` 显式加入；非 GPT 模型不会通过命令意外收到 priority 等级。
- 核心 LLM 调用类型增加一个提供方无关的服务等级字段，但每个适配器仍负责支持性检查和 wire 转换。
- Fast 激活的 session 在选择不支持 Fast 的逻辑模型后必须先禁用模式；请求 middleware 会拒绝不安全组合，而不是静默丢弃偏好。

## 相关记录

- [跨提供方逻辑模型策略路由](2026-08-17-logical-model-policy-routing.md)拥有逻辑提供方、路由顺序、能力筛选和内容前故障切换。
- [可重建请求](2026-07-05-reconstructable-requests.md)拥有使生效模型可见配置持久化的 request header 规则。
- [提供方路由 LLM 适配器](2026-07-14-provider-routed-llm-adapters.md)拥有物理提供方路由所有权和 pi-ai 回放转换。
