import { config } from "../../utils/config.js";
import { KsefApiError } from "../../utils/errors.js";
import { log } from "../../utils/logger.js";

interface RequestOptions {
  sessionToken?: string;
  contentType?: string;
  timeoutMs?: number;
  rawBody?: boolean;
}

export async function ksefRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const url = path.startsWith("https://") ? path : `${config.baseUrl}${path}`;
  const timeout = options?.timeoutMs ?? 30_000;

  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (options?.sessionToken) {
    headers["SessionToken"] = options.sessionToken;
  }

  if (body && !options?.rawBody) {
    headers["Content-Type"] = options?.contentType ?? "application/json";
  }

  log("debug", `KSeF ${method} ${path}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? (options?.rawBody ? (body as BodyInit) : JSON.stringify(body)) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      let errorBody: unknown;
      try {
        errorBody = await response.json();
      } catch {
        errorBody = { status: response.status, statusText: response.statusText };
      }
      throw new KsefApiError(response.status, errorBody);
    }

    if (response.status === 204) return {} as T;

    const text = await response.text();
    if (!text) return {} as T;

    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}
