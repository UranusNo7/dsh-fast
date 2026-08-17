import { describe, expect, it } from 'vitest'
import { FirecrawlFetchProvider, FIRECRAWL_DEFAULT_BASE_URL, FIRECRAWL_DEFAULT_MAX_CONTENT_CHARS } from '@deepseek-ai/dsh-web-fetch-firecrawl'

/**
 * Real-API smoke for the Firecrawl fetch provider. Self-skips without
 * `$FIRECRAWL_API_KEY` (CI has no secrets), per the with-key e2e policy in docs/testing.md.
 */
const apiKey = process.env.FIRECRAWL_API_KEY
const maybe = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip

maybe('FirecrawlFetchProvider real API', () => {
  it('returns the page markdown for a live URL', async () => {
    const provider = new FirecrawlFetchProvider({
      apiKey: apiKey!,
      baseURL: process.env.FIRECRAWL_BASE_URL ?? FIRECRAWL_DEFAULT_BASE_URL,
      maxContentChars: FIRECRAWL_DEFAULT_MAX_CONTENT_CHARS,
      onlyMainContent: true,
    })
    const result = await provider.fetch({ url: 'https://example.com' })
    expect(result.statusCode).toBe(200)
    expect(result.body.kind).toBe('text')
    expect(result.body.content.length).toBeGreaterThan(0)
    expect(result.url).toMatch(/^https?:\/\//)
  }, 60_000)
})
