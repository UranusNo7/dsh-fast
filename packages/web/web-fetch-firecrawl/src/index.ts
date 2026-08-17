/**
 * `@deepseek-ai/dsh-web-fetch-firecrawl`: registers a Firecrawl-backed `WebFetchProvider`
 * with `ctx.web`. A function/namespace plugin (NOT a default-export service): it registers INTO
 * the seam's fetch registry, exactly as `@deepseek-ai/dsh-web-fetch-http` registers the local
 * HTTP fetcher. The `ctx.web` key is owned by `@deepseek-ai/dsh-web`.
 *
 * @module @deepseek-ai/dsh-web-fetch-firecrawl
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  FirecrawlFetchProvider,
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_MAX_CONTENT_CHARS,
} from './provider.ts'

export {
  FIRECRAWL_DEFAULT_BASE_URL,
  FIRECRAWL_DEFAULT_MAX_CONTENT_CHARS,
  FIRECRAWL_FETCH_PROVIDER_ID,
  FirecrawlFetchProvider,
} from './provider.ts'
export type { FirecrawlFetchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-fetch-firecrawl'

/** The web seam this provider registers into. */
export const inject = ['web']

const DEFAULT_API_KEY_ENV = 'FIRECRAWL_API_KEY'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Literal Firecrawl API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each scrape; defaults to `FIRECRAWL_API_KEY`. */
  apiKeyEnv?: string
  /** Endpoint base; `/scrape` is appended. Defaults to the public API. */
  baseURL?: string
  /** Maximum Markdown characters kept from one scrape. Defaults to 100000. */
  maxContentChars?: number
  /** Ask Firecrawl to return only the main page content. Defaults to true. */
  onlyMainContent?: boolean
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  maxContentChars: z.number().step(1).min(1),
  onlyMainContent: z.boolean(),
})

/** Register the Firecrawl fetch provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  ctx.web.registerFetchProvider(new FirecrawlFetchProvider({
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      // Without the seam the launch environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL ?? FIRECRAWL_DEFAULT_BASE_URL,
    maxContentChars: config.maxContentChars ?? FIRECRAWL_DEFAULT_MAX_CONTENT_CHARS,
    onlyMainContent: config.onlyMainContent ?? true,
  }))
}
