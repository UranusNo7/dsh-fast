# @deepseek-ai/dsh-web-fetch-firecrawl

English | [中文](README.zh.md)

A [Firecrawl](https://firecrawl.dev)-backed `WebFetchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It deep-scrapes a URL through Firecrawl's `POST /scrape` endpoint and returns the page's Markdown as a `text` body.

This is an **implementation** package: it registers a provider into `ctx.web`, it does not own the key and it does not register a model-facing tool (that is `@deepseek-ai/dsh-tool-web`). It is a function/namespace plugin (`inject: ['web']`) that registers its backend, not a default-export service.

## Responsibility split

The provider owns **deep-scrape retrieval**: target-URL validation, the credential-bearing Firecrawl API request, redirect rejection, abort propagation, and the Markdown character cap. Firecrawl fetches the page server-side (rendering JavaScript), so this provider never contacts the target URL itself. `@deepseek-ai/dsh-tool-web` owns **presentation** (the fetch card and output cap). A non-2xx *target page* is a result (`metadata.statusCode` + possibly empty body), not an error; `WebError` is reserved for failures to safely scrape or represent the page.

The provider has no timeout backstop of its own: it forwards the caller's abort signal, and [`dsh-tool-call-timeout-policy`](../../guard/timeout-policy/README.md) owns the `web_fetch` tool-call budget by arming `exec.signal`.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | (unset) | Literal Firecrawl API key. Prefer `apiKeyEnv` so no secret enters configuration files. |
| `apiKeyEnv` | `FIRECRAWL_API_KEY` | Credential reference resolved for each scrape, through the credentials service then the launch environment. A missing key fails the scrape with `WEB_PROVIDER_CREDENTIAL_MISSING`. |
| `baseURL` | `https://api.firecrawl.dev/v2` | Endpoint base; `/scrape` is appended. An unparseable value makes the provider unavailable. |
| `maxContentChars` | `100000` | Maximum Markdown characters kept from one scrape (truncation is flagged). Must be a positive integer. |
| `onlyMainContent` | `true` | Ask Firecrawl to strip navigation and return only the main page content. |

```yaml
- id: web-fetch-firecrawl
  name: '@deepseek-ai/dsh-web-fetch-firecrawl'
  config:
    apiKeyEnv: FIRECRAWL_API_KEY
```

## Mapping

The API key is resolved for each scrape (literal `apiKey` wins, else the credentials service, else the launch environment); a keyless scrape fails with `WEB_PROVIDER_CREDENTIAL_MISSING`. The request `url` is sent as Firecrawl's `url` with a fixed `formats: ['markdown']`. On success, `data.markdown` maps to a `text` body, capped to `maxContentChars` and flagged `truncated`; `metadata.statusCode` maps to the result's `statusCode` (the target page's status, defaulting to `200`); and `metadata.sourceURL` maps to the result's final `url`, falling back to the request URL when absent. Provider failures (HTTP errors, a `success: false` body, network failure, unparseable or wrong-shape bodies) surface as `WebError` `WEB_PROVIDER_ERROR`; an invalid or credential-bearing target URL surfaces as `WEB_INVALID_URL`/`WEB_BLOCKED_URL`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects on the credential-bearing API request are rejected before the `Location` target is contacted.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which places this provider's `maxContentChars`-bounded Markdown under its fetch-result wrapper (`Fetched <url> (HTTP <status>)`) and retains provider failures while the Firecrawl API, key, and transport mechanics remain hidden.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Every requested URL is sent to Firecrawl's servers** — deep scraping runs on Firecrawl's network, not the harness's, so a URL naming an internal or private host is disclosed to a third party rather than fetched locally. Do not enable this provider where the model may name sensitive internal URLs.
- **Only Markdown is returned** — `formats: ['markdown']` is fixed, so raw HTML is never available; `onlyMainContent: true` can drop legitimate content Firecrawl does not classify as main content.
- **No timeout backstop** — the provider relies on the caller's signal (the `web_fetch` tool-call budget); a direct `ctx.web.fetch()` caller without a signal has no deadline of its own.
