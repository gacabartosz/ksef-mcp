#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { ensureDataDirs, config } from "./utils/config.js";
import { log } from "./utils/logger.js";
import { collectAllTools, handleToolCall } from "./mcp/registry.js";

// Import tool registrations (side-effect: registers tools in registry)
import "./mcp/auth-tools.js";
import "./mcp/query-tools.js";
import "./mcp/draft-tools.js";
import "./mcp/send-tools.js";
import "./mcp/correction-tools.js";
import "./mcp/batch-tools.js";
import "./mcp/token-tools.js";

// ─── Server ─────────────────────────────────────────────────────────────────────

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

// ─── Entry Point ────────────────────────────────────────────────────────────────

async function main() {
  // CLI flags
  if (process.argv.includes("--version")) {
    process.stdout.write("ksef-mcp 0.1.0\n");
    process.exit(0);
  }
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "ksef-mcp — MCP server dla Krajowego Systemu e-Faktur (KSeF)\n\n" +
      "Użycie:\n" +
      "  ksef-mcp              Uruchom serwer MCP (stdio)\n" +
      "  ksef-mcp --version    Pokaż wersję\n" +
      "  ksef-mcp --help       Pokaż pomoc\n\n" +
      "Zmienne środowiskowe:\n" +
      "  KSEF_ENV              Środowisko: test | demo | prod (domyślnie: test)\n" +
      "  KSEF_NIP              NIP podmiotu (10 cyfr)\n" +
      "  KSEF_TOKEN            Token autoryzacyjny KSeF\n" +
      "  KSEF_DATA_DIR         Katalog danych (domyślnie: ~/.ksef-mcp)\n" +
      "  KSEF_LOG_LEVEL        Poziom logów: debug | info | warn | error\n",
    );
    process.exit(0);
  }

  ensureDataDirs();

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("info", `ksef-mcp uruchomiony (${config.env}), tools: ${collectAllTools().length}`);
}

main().catch((err) => {
  log("error", "Błąd krytyczny", err);
  process.exit(1);
});
