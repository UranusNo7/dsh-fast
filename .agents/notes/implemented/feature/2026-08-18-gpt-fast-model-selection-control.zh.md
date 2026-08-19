# Agent Note: GPT Fast 模型选择控制

Status: implemented

[English](2026-08-18-gpt-fast-model-selection-control.md) | 中文

## 问题

逻辑模型策略已经拥有持久化、会话级的 Fast 意图，但 Fast 需要在 Web 模型选择器的推理选项旁提供可发现的控制项。通过斜杠命令注册会把模型能力拆分到命令目录和模型选择 UI，而 React 本地状态无法在刷新或恢复后保留。

## 决策

逻辑模型策略提供可选的 `modelPolicy` 控制器，包含 `getFast()` 和 `setFast()` 操作。Host 的 `session.models` 响应携带可选的 `{ active, available }` 状态，模型目录携带可选的 `supportsFast` 元数据。`session.selectModel` 接受可选的 `fast` 值并委托给控制器；没有该策略的 profile 保持现有线路字段不变。

`ModelDirectory` 在当前 `ModelSelection` 旁持有 Fast 状态，因此 `/model` 贡献项和 composer 共用一个会话 store。Composer 将 Fast 作为 `menuitemcheckbox` 和开关样式显示在适配器提供的推理选项下方。当所选逻辑模型支持 Fast，或必须关闭已激活的 Fast 时，组件显示该控制项；已激活但当前不支持的状态仍可关闭。开关通过 `session.selectModel` 提交，只有请求成功后 UI 才发布 Host 返回的状态。

控制器仍然拥有持久化的 `model-policy/fast` 事件。现有 request middleware 折叠该事件，并且只对支持 Fast 的 GPT 逻辑模型应用 `serviceTier: 'fast'`；`dsh-llm-pi-ai` 负责 OpenAI 的 `service_tier: priority` 字段拼写。策略不再注册斜杠命令。

## 测试

策略测试覆盖控制器提交、GPT-only 拒绝、持久化 request header 和 Loader 组合。Host API 测试覆盖可选 Fast 状态往返。浏览器组合测试覆盖共享目录的开关连线，`ModelSelect` 测试覆盖 GPT-only 控件、选中状态更新、不支持模型的隐藏和原有推理选项行为。

## 考虑过的替代方案

- **保留 `/fast` 作为用户开关**——不予采纳，因为 Fast 是所选逻辑模型的能力，应当与模型推理选项并列；策略仍保留相同的持久化事件和请求行为，但不暴露命令注册。
- **把 Fast 保存在 React 组件状态中**——不予采纳，因为 `/model` popup 和 composer 会分叉，刷新或恢复会丢失 Host 权威的会话状态。
- **增加独立的 Fast RPC**——不予采纳，因为现有 `session.selectModel` 提交已经通过 Host 的会话选择路径串行化模型与 Fast 变化，并返回一份已接受的状态。
- **隐藏不支持模型上的已激活 Fast**——不予采纳，因为会话将失去 UI 恢复路径；已激活的控件必须继续可见以关闭不安全偏好。

## 后果

- 只有可选的模型策略控制器和所选模型能力共同表明 Fast 有意义时，UI 才显示 Fast；没有该策略的 profile 保持不变。
- Fast 变化通过 `model-policy/fast` 仅作用于当前会话并保持持久化，模型目录和 UI 只携带其可选投影。
- 模型选择包不依赖策略运行时包；它消费结构化的 Host API 字段和注入的控制器结果。
- 面向用户的 Fast 切换不再属于斜杠命令目录，因此可用该 UI 时，命令客户端应使用模型选择控件。

## 相关记录

- [GPT 会话级 Fast 模式](../architecture/2026-08-17-gpt-fast-session-mode.md)拥有持久化 Fast 意图、GPT 能力门控和 request-header 应用。
- [跨提供方逻辑模型策略路由](../architecture/2026-08-17-logical-model-policy-routing.md)拥有逻辑提供方路由和能力元数据。
- [Web 会话模型选择器](2026-07-24-web-session-model-selector.md)拥有共享模型选择目录和 Host 选择语义。
