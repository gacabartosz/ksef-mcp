#!/usr/bin/env node

/**
 * HTTP entry point for ksef-mcp.
 * Exposes the MCP server over Streamable HTTP transport (for claude.ai connectors).
 *
 * Usage:
 *   MCP_PORT=3400 node dist/http.js
 *
 * Nginx reverse proxy:
 *   location /ksef { proxy_pass http://127.0.0.1:3400; }
 */

import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import { ensureDataDirs, config } from "./utils/config.js";
import { log } from "./utils/logger.js";
import { collectAllTools, handleToolCall } from "./mcp/registry.js";

// Import tool registrations (side-effect)
import "./mcp/auth-tools.js";
import "./mcp/query-tools.js";
import "./mcp/draft-tools.js";
import "./mcp/send-tools.js";
import "./mcp/correction-tools.js";
import "./mcp/batch-tools.js";
import "./mcp/token-tools.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isInitializeRequest(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.some(
      (msg) => typeof msg === "object" && msg !== null && (msg as Record<string, unknown>).method === "initialize",
    );
  }
  return (
    typeof body === "object" &&
    body !== null &&
    (body as Record<string, unknown>).method === "initialize"
  );
}

function createMcpServer(): Server {
  const server = new Server(
    { name: "ksef-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: collectAllTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    log("debug", `Tool call: ${name}`, { args: Object.keys(args) });
    return handleToolCall(name, args as Record<string, unknown>);
  });

  return server;
}

// ─── Session Management ───────────────────────────────────────────────────────

const transports = new Map<string, StreamableHTTPServerTransport>();

// ─── Express App ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Health check
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    server: "ksef-mcp",
    version: "0.1.0",
    env: config.env,
    tools: collectAllTools().length,
    activeSessions: transports.size,
  });
});

// MCP endpoint — POST (JSON-RPC messages)
app.post("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  try {
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!;
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New session
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid: string) => {
          transports.set(sid, transport);
          log("info", `HTTP session created: ${sid.slice(0, 8)}...`);
        },
        onsessionclosed: (sid: string) => {
          transports.delete(sid);
          log("info", `HTTP session closed: ${sid.slice(0, 8)}...`);
        },
      });

      const server = createMcpServer();
      await server.connect(transport);
    } else {
      res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: no valid session" },
        id: null,
      });
      return;
    }

    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    log("error", "HTTP POST /mcp error", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// MCP endpoint — GET (SSE stream)
app.get("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }

  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res);
});

// MCP endpoint — DELETE (session termination)
app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: "Invalid or missing session ID" });
    return;
  }

  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res);
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.MCP_PORT ?? "3400", 10);

async function main() {
  ensureDataDirs();

  app.listen(PORT, "127.0.0.1", () => {
    log("info", `ksef-mcp HTTP uruchomiony na http://127.0.0.1:${PORT}/mcp (${config.env}), tools: ${collectAllTools().length}`);
  });
}

// Graceful shutdown
process.on("SIGINT", async () => {
  log("info", "Shutting down HTTP server...");
  for (const [sid, transport] of transports) {
    try {
      await transport.close();
    } catch { /* ignore */ }
    transports.delete(sid);
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  for (const [, transport] of transports) {
    try { await transport.close(); } catch { /* ignore */ }
  }
  process.exit(0);
});

main().catch((err) => {
  log("error", "Błąd krytyczny HTTP", err);
  process.exit(1);
});
