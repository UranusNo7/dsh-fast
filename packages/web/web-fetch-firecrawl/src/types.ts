/**
 * Wire types for the Firecrawl scrape API (`POST https://api.firecrawl.dev/v2/scrape`). Types
 * only — no runtime code. A successful scrape returns the page as `data.markdown` plus a
 * `metadata` envelope carrying the target's status code and final source URL; failures carry
 * `success: false` and an `error` string.
 *
 * @module @deepseek-ai/dsh-web-fetch-firecrawl/types
 */

/** A successful scrape's `data` object. */
export interface FirecrawlScrapeData {
  /** The scraped page as Markdown text (empty when the page returned no content). */
  markdown?: string
  /** Scrape metadata: the target page's status code, final source URL, and title. */
  metadata?: FirecrawlScrapeMetadata
}

/** Metadata Firecrawl attaches to one scrape. */
export interface FirecrawlScrapeMetadata {
  /** HTTP status code of the scraped page (Firecrawl's own scrape job is always 2xx). */
  statusCode?: number
  /** Final URL after Firecrawl followed the page's redirects server-side. */
  sourceURL?: string
  /** Page title Firecrawl extracted, when present. */
  title?: string
}

/** The scrape response envelope, success or failure. */
export interface FirecrawlScrapeResponse {
  /** Whether Firecrawl completed the scrape. Absent is treated as a malformed body. */
  success?: boolean
  /** Present on success; carries the Markdown and metadata. */
  data?: FirecrawlScrapeData
  /** Present on failure; the provider-facing error message. */
  error?: string
}

/** Firecrawl's error response envelope (best-effort; fields vary by failure). */
export interface FirecrawlError {
  error?: string
  message?: string
}
