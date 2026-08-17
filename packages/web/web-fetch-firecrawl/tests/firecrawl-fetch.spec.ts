import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import WebRuntime from '@deepseek-ai/dsh-web'
import { FirecrawlFetchProvider, FIRECRAWL_FETCH_PROVIDER_ID } from '@deepseek-ai/dsh-web-fetch-firecrawl'
import * as firecrawlPlugin from '@deepseek-ai/dsh-web-fetch-firecrawl'
import { mapFirecrawlResponse, validateFirecrawlUrl } from '../src/provider.ts'
import type { FirecrawlScrapeResponse } from '../src/types.ts'

const options = { apiKey: 'fc-key', baseURL: 'https://api.firecrawl.test', maxContentChars: 100_000, onlyMainContent: true }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

function scrapeData(markdown: string, statusCode = 200, sourceURL = 'https://final.test'): FirecrawlScrapeResponse {
  return { success: true, data: { markdown, metadata: { statusCode, sourceURL } } }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Firecrawl response mapping', () => {
  it('maps markdown to a text body with the metadata status and final URL', () => {
    expect(mapFirecrawlResponse(scrapeData('# Hi'), 'https://req.test', 1000)).toEqual({
      url: 'https://final.test',
      statusCode: 200,
      body: { kind: 'text', content: '# Hi' },
      truncated: false,
    })
  })

  it('reports a non-2xx target status as a result, not an error', () => {
    expect(mapFirecrawlResponse(scrapeData('', 404), 'https://req.test', 1000)).toEqual({
      url: 'https://final.test',
      statusCode: 404,
      body: { kind: 'text', content: '' },
      truncated: false,
    })
  })

  it('truncates markdown past the character cap and flags it', () => {
    expect(mapFirecrawlResponse(scrapeData('abcdef'), 'https://req.test', 3)).toEqual({
      url: 'https://final.test',
      statusCode: 200,
      body: { kind: 'text', content: 'abc' },
      truncated: true,
    })
  })

  it('does not flag a body exactly at the character cap as truncated', () => {
    expect(mapFirecrawlResponse(scrapeData('abc'), 'https://req.test', 3)).toMatchObject({
      body: { kind: 'text', content: 'abc' },
      truncated: false,
    })
  })

  it('falls back to the request URL when sourceURL is absent or blank', () => {
    expect(mapFirecrawlResponse({ success: true, data: { markdown: 'x', metadata: { statusCode: 200 } } }, 'https://req.test', 100)).toMatchObject({ url: 'https://req.test' })
    expect(mapFirecrawlResponse({ success: true, data: { markdown: 'x', metadata: { statusCode: 200, sourceURL: '' } } }, 'https://req.test', 100)).toMatchObject({ url: 'https://req.test' })
  })

  it('defaults an absent status code to 200', () => {
    expect(mapFirecrawlResponse({ success: true, data: { markdown: 'x' } }, 'https://req.test', 100)).toMatchObject({ statusCode: 200 })
  })

  it('tolerates a missing data object as an empty text body', () => {
    expect(mapFirecrawlResponse({ success: true }, 'https://req.test', 100)).toEqual({
      url: 'https://req.test',
      statusCode: 200,
      body: { kind: 'text', content: '' },
      truncated: false,
    })
  })
})

describe('Firecrawl URL validation', () => {
  it('accepts http and https URLs', () => {
    expect(validateFirecrawlUrl('https://example.com/x').hostname).toBe('example.com')
    expect(validateFirecrawlUrl('http://example.com').protocol).toBe('http:')
  })

  it('rejects non-http schemes', () => {
    expect(() => validateFirecrawlUrl('ftp://example.com')).toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
    expect(() => validateFirecrawlUrl('file:///etc/passwd')).toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
  })

  it('rejects unparseable URLs', () => {
    expect(() => validateFirecrawlUrl('not a url')).toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
  })

  it('rejects credentials embedded in the URL', () => {
    expect(() => validateFirecrawlUrl('https://user:pass@example.com')).toThrow(expect.objectContaining({ code: 'WEB_BLOCKED_URL' }))
  })
})

describe('FirecrawlFetchProvider availability', () => {
  it('is unavailable without a key', () => {
    expect(new FirecrawlFetchProvider({ ...options, apiKey: '' }).available()).toBe(false)
  })

  it('is available with a key', () => {
    expect(new FirecrawlFetchProvider(options).available()).toBe(true)
  })

  it('is available with a key resolver when no literal key is set', () => {
    expect(new FirecrawlFetchProvider({ ...options, apiKey: '', resolveApiKey: async () => 'k' }).available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(new FirecrawlFetchProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
  })

  it('is misconfigured when maxContentChars is not a positive integer', () => {
    expect(new FirecrawlFetchProvider({ ...options, maxContentChars: 0 }).available()).toBe(false)
    expect(new FirecrawlFetchProvider({ ...options, maxContentChars: 1.5 }).available()).toBe(false)
  })
})

describe('FirecrawlFetchProvider request mapping', () => {
  it('sends url, markdown format, onlyMainContent and bearer auth', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(scrapeData('# Hi')))
    vi.stubGlobal('fetch', fetchMock)

    await new FirecrawlFetchProvider(options).fetch({ url: 'https://a.test' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.firecrawl.test/scrape')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer fc-key')
    expect(JSON.parse(init.body as string)).toEqual({
      url: 'https://a.test',
      formats: ['markdown'],
      onlyMainContent: true,
    })
  })

  it('honors onlyMainContent: false', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(scrapeData('full')))
    vi.stubGlobal('fetch', fetchMock)
    await new FirecrawlFetchProvider({ ...options, onlyMainContent: false }).fetch({ url: 'https://a.test' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ onlyMainContent: false })
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(scrapeData('x')))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new FirecrawlFetchProvider(options).fetch({ url: 'https://a.test' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })

  it('rejects an invalid URL before any network access', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(new FirecrawlFetchProvider(options).fetch({ url: 'ftp://a.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_INVALID_URL' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('FirecrawlFetchProvider credential resolution', () => {
  it('sends the resolver-returned key as bearer auth', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(scrapeData('x')))
    vi.stubGlobal('fetch', fetchMock)
    await new FirecrawlFetchProvider({ ...options, apiKey: '', resolveApiKey: async () => 'resolved-key' }).fetch({ url: 'https://a.test' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer resolved-key')
  })

  it('maps a credential resolver rejection to WEB_PROVIDER_ERROR', async () => {
    await expect(new FirecrawlFetchProvider({ ...options, apiKey: '', resolveApiKey: () => Promise.reject(new Error('credential backend failed')) }).fetch({ url: 'https://a.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Firecrawl credential resolution failed: Error: credential backend failed' }))
  })

  it('reports WEB_PROVIDER_CREDENTIAL_MISSING when no key is available', async () => {
    await expect(new FirecrawlFetchProvider({ ...options, apiKey: '' }).fetch({ url: 'https://a.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }))
  })

  it('honors a pre-aborted signal before credential resolution', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(new FirecrawlFetchProvider({ ...options, apiKey: '', resolveApiKey: async () => 'k' }).fetch({ url: 'https://a.test' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('FirecrawlFetchProvider error handling', () => {
  it('maps an HTTP error to WEB_PROVIDER_ERROR with the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, error: 'Unauthorized: Invalid token' }, { status: 401 })))
    await expect(new FirecrawlFetchProvider(options).fetch({ url: 'https://a.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Unauthorized: Invalid token' }))
  })

  it('keeps a status-line message when the error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('gateway down', { status: 502 })))
    await expect(new FirecrawlFetchProvider(options).fetch({ url: 'https://a.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'Firecrawl API error (HTTP 502)' }))
  })

  it('keeps the status-line message when the JSON error body carries no detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, { status: 500 })))
    await expect(new FirecrawlFetchProvider(options).fetch({ url: 'https://a.test' }))
      .rejects.toThrow(expect.objectContaining({ message: 'Firecrawl API error (HTTP 500)' }))
  })

  it('maps a 2xx success:false body to WEB_PROVIDER_ERROR with the error message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: false, error: 'scrape rejected' })))
    await expect(new FirecrawlFetchProvider(options).fetch({ url: 'https://a.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'scrape rejected' }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new FirecrawlFetchProvider(options).fetch({ url: 'https://a.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new FirecrawlFetchProvider(options).fetch({ url: 'https://a.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('honors a pre-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(new FirecrawlFetchProvider(options).fetch({ url: 'https://a.test' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps an unparseable success body to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })))
    await expect(new FirecrawlFetchProvider(options).fetch({ url: 'https://a.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps a well-formed body of the wrong shape to WEB_PROVIDER_ERROR, not a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ success: true, data: { markdown: {} } }, { status: 200 })))
    await expect(new FirecrawlFetchProvider(options).fetch({ url: 'https://a.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('surfaces an abort during success-body parse as WEB_ABORTED, not provider error', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new FirecrawlFetchProvider(options).fetch({ url: 'https://a.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during error-body parse as WEB_ABORTED', async () => {
    const body = { json: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: false, status: 500 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new FirecrawlFetchProvider(options).fetch({ url: 'https://a.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

describe('web-fetch-firecrawl plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(scrapeData('x'))))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { fetchProvider: FIRECRAWL_FETCH_PROVIDER_ID })
    const fiber = await ctx.plugin(firecrawlPlugin, { apiKey: 'fc-key' })
    await expect(ctx.web.fetch({ url: 'https://a.test' })).resolves.toMatchObject({ statusCode: 200 })
    await fiber.dispose()
    await expect(ctx.web.fetch({ url: 'https://a.test' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in firecrawlPlugin).toBe(false)
  })

  it('falls back to $FIRECRAWL_API_KEY and the default base URL when config omits them', async () => {
    const prev = process.env.FIRECRAWL_API_KEY
    process.env.FIRECRAWL_API_KEY = 'env-key'
    try {
      const fetchMock = vi.fn(async () => jsonResponse(scrapeData('x')))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { fetchProvider: FIRECRAWL_FETCH_PROVIDER_ID })
      const fiber = await ctx.plugin(firecrawlPlugin, {})
      await ctx.web.fetch({ url: 'https://a.test' })
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('https://api.firecrawl.dev/v2/scrape')
      expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer env-key')
      await fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.FIRECRAWL_API_KEY
      else process.env.FIRECRAWL_API_KEY = prev
    }
  })

  it('reports an actionable credential error when neither config nor env supplies a key', async () => {
    const prev = process.env.FIRECRAWL_API_KEY
    delete process.env.FIRECRAWL_API_KEY
    try {
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { fetchProvider: FIRECRAWL_FETCH_PROVIDER_ID })
      await ctx.plugin(firecrawlPlugin, {})
      let caught: unknown
      try {
        await ctx.web.fetch({ url: 'https://a.test' })
      } catch (error: unknown) {
        caught = error
      }
      expect(caught).toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
      if (!(caught instanceof Error)) throw new Error('fetch did not throw an Error')
      expect(caught.message).toMatch(/store it through the credentials service.*Models page/s)
    } finally {
      if (prev !== undefined) process.env.FIRECRAWL_API_KEY = prev
    }
  })

  it('resolves the credential for each scrape so a stored or rotated key needs no restart', async () => {
    const previous = process.env.FIRECRAWL_API_KEY
    delete process.env.FIRECRAWL_API_KEY
    const dir = await mkdtemp(join(tmpdir(), 'dsh-web-fetch-firecrawl-credentials-'))
    const fetchMock = vi.fn(async () => jsonResponse(scrapeData('x')))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    try {
      await ctx.plugin(WebRuntime, { fetchProvider: FIRECRAWL_FETCH_PROVIDER_ID })
      await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
      await ctx.plugin(firecrawlPlugin, {})

      await expect(ctx.web.fetch({ url: 'https://a.test' }))
        .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }))

      const ref = credentialRef('FIRECRAWL_API_KEY')
      await ctx.credentials.set(ref, 'stored-key')
      await ctx.web.fetch({ url: 'https://a.test' })
      await ctx.credentials.set(ref, 'rotated-key')
      await ctx.web.fetch({ url: 'https://a.test' })

      const headers = (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(([, init]) => init.headers as Record<string, string>)
      expect(headers.map(value => value['authorization'])).toEqual(['Bearer stored-key', 'Bearer rotated-key'])
    } finally {
      await ctx.fiber.dispose()
      await rm(dir, { recursive: true, force: true })
      if (previous === undefined) delete process.env.FIRECRAWL_API_KEY
      else process.env.FIRECRAWL_API_KEY = previous
    }
  })
})
