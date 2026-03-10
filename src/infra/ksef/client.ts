import { config } from "../../utils/config.js";
import { KsefApiError } from "../../utils/errors.js";
import { log } from "../../utils/logger.js";
import { rateLimiter } from "./rate-limiter.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Status codes that should NOT be retried (client errors). */
const NO_RETRY_STATUSES = new Set([400, 401, 403, 440]);

/** Max retries for server errors (500/502/503). */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff (ms). */
const BASE_BACKOFF_MS = 500;

// ─── Types ───────────────────────────────────────────────────────────────────

interface RequestOptions {
  sessionToken?: string;
  contentType?: string;
  timeoutMs?: number;
  rawBody?: boolean;
  /** Rate limit key — defaults to 'default'. Use endpoint category for granular limits. */
  rateLimitKey?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 1_000;
  const seconds = parseInt(header, 10);
  if (!isNaN(seconds) && seconds > 0) return seconds * 1_000;
  // Try HTTP-date format
  const date = new Date(header).getTime();
  if (!isNaN(date)) {
    const waitMs = date - Date.now();
    return waitMs > 0 ? waitMs : 1_000;
  }
  return 1_000;
}

// ─── Main Request Function ───────────────────────────────────────────────────

export async function ksefRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const url = path.startsWith("https://") ? path : `${config.baseUrl}${path}`;
  const timeout = options?.timeoutMs ?? 30_000;
  const rateLimitKey = options?.rateLimitKey ?? "default";

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (options?.sessionToken) {
    headers["Authorization"] = `Bearer ${options.sessionToken}`;
  }

  if (body && !options?.rawBody) {
    headers["Content-Type"] = options?.contentType ?? "application/json";
  }

  // ─── Rate limiting ─────────────────────────────────────────────────────
  await rateLimiter.acquire(rateLimitKey);

  // ─── Request with retry logic ──────────────────────────────────────────
  let lastError: KsefApiError | Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      log("debug", `KSeF ${method} ${path} — retry ${attempt}/${MAX_RETRIES}`);
    } else {
      log("debug", `KSeF ${method} ${path}`);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body
          ? options?.rawBody
            ? (body as BodyInit)
            : JSON.stringify(body)
          : undefined,
        signal: controller.signal,
      });

      clearTimeout(timer);

      // ── Success ──────────────────────────────────────────────────────
      if (response.ok) {
        if (response.status === 204) return {} as T;
        const text = await response.text();
        if (!text) return {} as T;
        return JSON.parse(text) as T;
      }

      // ── 429 Too Many Requests — wait and retry once ──────────────────
      if (response.status === 429) {
        const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
        log("warn", `KSeF rate limited (429), waiting ${retryAfterMs}ms`, { path });
        await sleep(retryAfterMs);

        // Re-acquire rate limiter slot after waiting
        await rateLimiter.acquire(rateLimitKey);

        // Single retry for 429
        const retryController = new AbortController();
        const retryTimer = setTimeout(() => retryController.abort(), timeout);
        try {
          const retryResponse = await fetch(url, {
            method,
            headers,
            body: body
              ? options?.rawBody
                ? (body as BodyInit)
                : JSON.stringify(body)
              : undefined,
            signal: retryController.signal,
          });
          clearTimeout(retryTimer);

          if (retryResponse.ok) {
            if (retryResponse.status === 204) return {} as T;
            const text = await retryResponse.text();
            if (!text) return {} as T;
            return JSON.parse(text) as T;
          }

          // Still failing after retry — throw
          let errorBody: unknown;
          try {
            errorBody = await retryResponse.json();
          } catch {
            errorBody = { status: retryResponse.status, statusText: retryResponse.statusText };
          }
          throw new KsefApiError(retryResponse.status, errorBody);
        } finally {
          clearTimeout(retryTimer);
        }
      }

      // ── Client errors (no retry) ────────────────────────────────────
      if (NO_RETRY_STATUSES.has(response.status)) {
        let errorBody: unknown;
        try {
          errorBody = await response.json();
        } catch {
          errorBody = { status: response.status, statusText: response.statusText };
        }
        throw new KsefApiError(response.status, errorBody);
      }

      // ── Server errors (500/502/503) — exponential backoff ────────────
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        const backoffMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
        log("warn", `KSeF server error ${response.status}, backoff ${backoffMs}ms`, {
          path,
          attempt,
        });
        let errorBody: unknown;
        try {
          errorBody = await response.json();
        } catch {
          errorBody = { status: response.status, statusText: response.statusText };
        }
        lastError = new KsefApiError(response.status, errorBody);
        await sleep(backoffMs);
        continue;
      }

      // ── Other error or max retries exhausted ─────────────────────────
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = { status: response.status, statusText: response.statusText };
      }
      throw new KsefApiError(response.status, errorBody);
    } catch (err) {
      clearTimeout(timer);

      // If it's already a KsefApiError, propagate (unless it's a retryable server error handled above)
      if (err instanceof KsefApiError) {
        if (NO_RETRY_STATUSES.has(err.status) || err.status === 429 || attempt >= MAX_RETRIES) {
          throw err;
        }
        lastError = err;
        continue;
      }

      // Network errors / AbortError — retry with backoff
      if (attempt < MAX_RETRIES) {
        const backoffMs = BASE_BACKOFF_MS * Math.pow(2, attempt);
        log("warn", `KSeF request error: ${(err as Error).message}, backoff ${backoffMs}ms`, {
          path,
          attempt,
        });
        lastError = err as Error;
        await sleep(backoffMs);
        continue;
      }

      throw err;
    }
  }

  // Should not reach here, but safety net
  if (lastError) throw lastError;
  throw new Error(`KSeF request failed after ${MAX_RETRIES} retries`);
}
