import { toolError, type ToolCallResult } from "../utils/errors.js";
import { log } from "../utils/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────────

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  annotations?: Record<string, boolean>;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolCallResult>;

// ─── Registry ───────────────────────────────────────────────────────────────────

const tools: ToolDefinition[] = [];
const handlers = new Map<string, ToolHandler>();

/**
 * Zarejestruj tool MCP.
 * Wywoływane z modułów auth-tools.ts, query-tools.ts itd.
 */
export function registerTool(
  definition: ToolDefinition,
  handler: ToolHandler,
): void {
  tools.push(definition);
  handlers.set(definition.name, handler);
}

/**
 * Zwróć listę wszystkich zarejestrowanych tooli.
 */
export function collectAllTools(): ToolDefinition[] {
  return tools;
}

/**
 * Obsłuż wywołanie toola.
 */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const handler = handlers.get(name);
  if (!handler) {
    return toolError(`Nieznane narzędzie: ${name}`);
  }

  try {
    return await handler(args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("error", `Błąd w tool ${name}`, { error: msg });
    return toolError(msg);
  }
}
