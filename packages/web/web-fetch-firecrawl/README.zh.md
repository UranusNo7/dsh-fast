# @deepseek-ai/dsh-web-fetch-firecrawl

[English](README.md) | 中文

由 [Firecrawl](https://firecrawl.dev) 支持的 `WebFetchProvider`，用于 harness [web 能力 seam](../web/README.md)（`ctx.web`）。它通过 Firecrawl 的 `POST /scrape` 端点深度抓取一个 URL，并把页面 Markdown 作为 `text` 正文返回。

这是一个**实现**包：它把 provider 注册进 `ctx.web`，不拥有该键，也不注册面向模型的工具（那是 `@deepseek-ai/dsh-tool-web`）。它是函数/命名空间插件（`inject: ['web']`），注册自己的后端，而非默认导出服务。

## 职责划分

该 provider 负责**深度抓取检索**：目标 URL 校验、携带凭据的 Firecrawl API 请求、重定向拒绝、中止传播与 Markdown 字符上限。Firecrawl 在服务端抓取页面（渲染 JavaScript），因此该 provider 自身绝不接触目标 URL。`@deepseek-ai/dsh-tool-web` 负责**呈现**（fetch 卡片与输出上限）。目标页面返回非 2xx 是*结果*（`metadata.statusCode` 加上可能为空的正文），不是错误；`WebError` 仅用于无法安全抓取或表示页面的情形。

该 provider 自身不设超时兜底：它转发调用方的中止信号，而 [`dsh-tool-call-timeout-policy`](../../guard/timeout-policy/README.md) 通过装配 `exec.signal` 负责 `web_fetch` 的工具调用预算。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | （未设置） | 字面量 Firecrawl API 密钥。优先用 `apiKeyEnv`，避免密钥进入配置文件。 |
| `apiKeyEnv` | `FIRECRAWL_API_KEY` | 每次抓取时解析的凭据引用，先走凭据服务、再走启动环境。缺密钥时抓取以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败。 |
| `baseURL` | `https://api.firecrawl.dev/v2` | 端点基址；追加 `/scrape`。无法解析时 provider 不可用。 |
| `maxContentChars` | `100000` | 一次抓取保留的 Markdown 字符上限（截断会被标记）。必须为正整数。 |
| `onlyMainContent` | `true` | 请求 Firecrawl 剥离导航、只返回页面主体内容。 |

```yaml
- id: web-fetch-firecrawl
  name: '@deepseek-ai/dsh-web-fetch-firecrawl'
  config:
    apiKeyEnv: FIRECRAWL_API_KEY
```

## 映射

API 密钥在每次抓取时解析（字面量 `apiKey` 优先，其次凭据服务，再次启动环境）；无密钥的抓取以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败。请求的 `url` 作为 Firecrawl 的 `url` 发送，固定使用 `formats: ['markdown']`。成功时，`data.markdown` 映射为 `text` 正文，截断到 `maxContentChars` 并标记 `truncated`；`metadata.statusCode` 映射为结果的 `statusCode`（目标页面状态码，缺省为 `200`）；`metadata.sourceURL` 映射为结果的最终 `url`，缺省时回退到请求 URL。provider 失败（HTTP 错误、`success: false` 正文、网络失败、无法解析或形状错误的正文）以 `WebError` `WEB_PROVIDER_ERROR` 暴露；无效或携带凭据的目标 URL 以 `WEB_INVALID_URL`/`WEB_BLOCKED_URL` 暴露；中止的请求以 `WEB_ABORTED` 暴露。携带凭据的 API 请求上的 HTTP 重定向会在接触 `Location` 目标之前被拒绝。

## 模型体验

间接通过 [`dsh-tool-web`](../tool-web/README.md) 体现：它把该 provider 经 `maxContentChars` 限定的 Markdown 置于 fetch 结果包装（`Fetched <url> (HTTP <status>)`）之下，并保留 provider 失败，而 Firecrawl API、密钥与传输细节保持隐藏。

#### KV 缓存影响

无直接影响；命名消费方拥有任何请求前缀变更。

## 已知限制与延期工作

- **每个请求的 URL 都会发送到 Firecrawl 的服务器** —— 深度抓取在 Firecrawl 的网络中执行，而非 harness 本地，因此指向内网或私有主机的 URL 会被披露给第三方，而不会在本地抓取。若模型可能提及敏感内网 URL，不要启用此 provider。
- **只返回 Markdown** —— `formats: ['markdown']` 固定，因此永远拿不到原始 HTML；`onlyMainContent: true` 可能丢弃 Firecrawl 未归类为主体的合法内容。
- **无超时兜底** —— provider 依赖调用方的信号（`web_fetch` 工具调用预算）；无信号的直接 `ctx.web.fetch()` 调用方没有自己的截止时间。
