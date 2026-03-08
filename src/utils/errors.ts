export class KsefApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    const msg =
      typeof body === "object" && body !== null && "message" in body
        ? (body as { message: string }).message
        : typeof body === "object" && body !== null && "exception" in body
          ? JSON.stringify((body as { exception: unknown }).exception)
          : JSON.stringify(body);
    super(`KSeF API ${status}: ${msg}`);
    this.name = "KsefApiError";
  }
}

export interface ToolCallResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
}

export function toolError(message: string): ToolCallResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

export function toolResult(data: unknown): ToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}
