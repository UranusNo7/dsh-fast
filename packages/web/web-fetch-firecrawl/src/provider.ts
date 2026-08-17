/**
 * `FirecrawlFetchProvider`: a `WebFetchProvider` that deep-scrapes a URL through Firecrawl's
 * `POST /scrape` endpoint and returns the page's Markdown as a `text` body. Firecrawl fetches the
 * page server-side (rendering JavaScript), so this provider never contacts the target URL itself
 * and never follows the page's redirects locally — `metadata.sourceURL` reports the final URL.
 * @module @deepseek-ai/dsh-web-fetch-firecrawl/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { FirecrawlError, FirecrawlScrapeResponse } from './types.ts'

/** Stable id this provider registers under. */
export const FIRECRAWL_FETCH_PROVIDER_ID = 'firecrawl'

/** Default Firecrawl API base; `/scrape` is the operation. */
export const FIRECRAWL_DEFAULT_BASE_URL = 'https://api.firecrawl.dev/v2'

/** Default maximum Markdown characters kept from one scrape. */
export const FIRECRAWL_DEFAULT_MAX_CONTENT_CHARS = 100_000

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies credential and constant defaults). */
export interface FirecrawlFetchProviderOptions {
  /** Literal Firecrawl API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current Firecrawl API key for one scrape operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: CredentialRef
  /** Endpoint base; `/scrape` is appended. */
  baseURL: string
  /** Maximum Markdown characters kept from one scrape (truncation is flagged). */
  maxContentChars: number
  /** Ask Firecrawl to strip navigation and return only the main page content. */
  onlyMainContent: boolean
}

/**
 * Validate a scrape target URL before it is sent to Firecrawl: http(s) only, no embedded
 * credentials, parseable. Throws {@link WebError} `WEB_INVALID_URL` or `WEB_BLOCKED_URL`.
 *
 * @param input - the raw URL string from the fetch request.
 * @returns the parsed URL.
 */
export function validateFirecrawlUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch (error: unknown) {
    throw new WebError(`invalid URL: ${input}`, 'WEB_INVALID_URL', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, 'WEB_INVALID_URL')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new WebError('credentials in URLs are not allowed', 'WEB_BLOCKED_URL')
  }
  return url
}

/**
 * Map a Firecrawl scrape response to a normalized fetch result. `markdown` is a `text` body;
 * `metadata.statusCode` is the target page's status (a non-2xx page is a result, not an error),
 * and `metadata.sourceURL` is the final URL after Firecrawl followed the page's redirects. The
 * returned Markdown is capped to `maxContentChars` and flagged `truncated`.
 *
 * @param response - the parsed `POST /scrape` response body.
 * @param requestUrl - the URL the caller asked to scrape (fallback when `sourceURL` is absent).
 * @param maxContentChars - inclusive bound on the returned Markdown length.
 * @returns the normalized fetch result.
 */
export function mapFirecrawlResponse(response: FirecrawlScrapeResponse, requestUrl: string, maxContentChars: number): WebFetchResult {
  const markdown = response.data?.markdown ?? ''
  const truncated = markdown.length > maxContentChars
  // Always slice: a non-string `markdown` (malformed wire body) throws here, matching
  // how the other providers reject a wrong-shaped response rather than emitting it.
  const content = markdown.slice(0, maxContentChars)
  const sourceURL = response.data?.metadata?.sourceURL
  return {
    url: sourceURL !== undefined && sourceURL.length > 0 ? sourceURL : requestUrl,
    statusCode: response.data?.metadata?.statusCode ?? 200,
    body: { kind: 'text', content },
    truncated,
  }
}

/** The Firecrawl-backed fetch provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class FirecrawlFetchProvider implements WebFetchProvider {
  readonly id = FIRECRAWL_FETCH_PROVIDER_ID

  constructor(private readonly options: FirecrawlFetchProviderOptions) {}

  available(): boolean {
    return ((this.options.apiKey?.length ?? 0) > 0 || this.options.resolveApiKey !== undefined)
      && URL.canParse(this.options.baseURL)
      && isPositiveInteger(this.options.maxContentChars)
  }

  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    throwIfFetchAborted(signal)
    validateFirecrawlUrl(request.url)
    const apiKey = await this.apiKey(signal)

    let response: Response
    try {
      response = await fetch(`${this.options.baseURL}/scrape`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({
          url: request.url,
          formats: ['markdown'],
          onlyMainContent: this.options.onlyMainContent,
        }),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw fetchAborted(signal, error)
      throw new WebError(`Firecrawl fetch request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Firecrawl API error (HTTP ${status})`
      try {
        const parsed = await response.json() as FirecrawlError
        const detail = parsed.error ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        // An abort fired mid-body must surface as WEB_ABORTED, not be swallowed
        // into a generic HTTP-error message — cancellation is not a provider
        // error (the seam's cancellation contract).
        if (signal?.aborted === true || isAbortError(error)) throw fetchAborted(signal, error)
        // Otherwise: the HTTP status is already captured in `message` above; a
        // malformed/non-JSON error body can only cost a richer provider message.
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as FirecrawlScrapeResponse
      if (payload.success === false) {
        throw new WebError(payload.error ?? 'Firecrawl scrape failed', 'WEB_PROVIDER_ERROR')
      }
      return mapFirecrawlResponse(payload, request.url, this.options.maxContentChars)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw fetchAborted(signal, error)
      if (error instanceof WebError) throw error
      throw new WebError(`Firecrawl returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  /**
   * Resolve one operation's credential without retaining it on the provider.
   * @param signal - abort signal for the surrounding fetch.
   * @returns the resolved key.
   */
  private async apiKey(signal?: AbortSignal): Promise<string> {
    throwIfFetchAborted(signal)
    if (this.options.apiKey !== undefined && this.options.apiKey.length > 0) return this.options.apiKey
    let resolved: string | undefined
    try {
      resolved = await abortable(this.options.resolveApiKey?.() ?? Promise.resolve(undefined), signal)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw fetchAborted(signal, error)
      throw new WebError(
        `Firecrawl credential resolution failed: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    const ref = this.options.apiKeyEnv ?? 'FIRECRAWL_API_KEY'
    throw new WebError(
      `Firecrawl fetch has no API key for "${ref}"; store it through the credentials service`
      + ' (the web Models page writes it), export it in the launching environment, or set a literal'
      + ' "apiKey" in the web-fetch-firecrawl config',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }
}

/**
 * Race a same-process asynchronous preflight against caller cancellation. The
 * attached settlement handlers keep observing an uncooperative operation after
 * abort so a later rejection cannot become unhandled.
 */
function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(fetchAborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(fetchAborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(new Error(String(error).replace(/^Error: /u, ''), { cause: error }))
      },
    )
  })
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfFetchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw fetchAborted(signal)
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function fetchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('Firecrawl fetch aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** True for a content bound that can be enforced locally (a positive whole number). */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}
