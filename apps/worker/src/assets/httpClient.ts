// Shared HTTP client for all three stock-asset providers (PexelsAdapter/
// PixabayAdapter/UnsplashAdapter) - keeps timeout handling and "what counts
// as a failure" logic in exactly one place instead of duplicated per
// adapter. Built on native fetch (Node 20+, already used elsewhere in this
// package - see broll.ts) rather than adding an axios dependency this
// monorepo doesn't otherwise have.
const DEFAULT_TIMEOUT_MS = 10_000;

// Thrown for any non-2xx response - callers (each adapter's search()) let
// this propagate rather than catching it themselves, so a real provider
// outage/rate-limit surfaces as a genuine error for StockAssetService's
// per-provider fallback to react to, distinct from "no results" (which
// each adapter represents as a null return, not an exception).
export class HttpRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpRequestError';
  }
}

// GETs `url` and parses the response as JSON. Aborts (and throws) after
// timeoutMs rather than hanging indefinitely on a slow/stalled provider -
// same reasoning as packages/storage's S3 client timeout fix (CLAUDE.md).
export async function fetchJson<T>(
  url: string,
  options: { headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, { headers: options.headers, signal: controller.signal });
    if (!response.ok) {
      throw new HttpRequestError(
        `Request to ${url} failed with status ${response.status}`,
        response.status,
      );
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}
