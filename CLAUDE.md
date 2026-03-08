# CLAUDE.md — ksef-mcp

## Build & Run

```bash
npm run build          # TypeScript compile + shebang injection
npm run dev            # Dev mode with tsx
npm start              # Run compiled dist/index.js
```

Verify tools after changes:
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | node dist/index.js
```

## Architecture

- `src/index.ts` — MCP server entry point, Server + StdioServerTransport
- `src/mcp/registry.ts` — Modular tool registry (registerTool, collectAll, dispatch)
- `src/mcp/auth-tools.ts` — Auth tools: ksef_env_info, ksef_auth_init, ksef_auth_status, ksef_auth_terminate
- `src/mcp/query-tools.ts` — Query tools: ksef_invoices_query, ksef_invoice_get, ksef_invoice_status, ksef_invoice_xml, ksef_upo_download
- `src/infra/ksef/client.ts` — HTTP client for KSeF API (fetch + timeout + error mapping)
- `src/infra/ksef/auth.ts` — Auth flow: challenge, initTokenSession, getSessionStatus, terminateSession
- `src/infra/ksef/crypto.ts` — RSA-OAEP, AES-256-CBC, SHA-256
- `src/utils/config.ts` — Environment variables, base URLs, data dirs
- `src/utils/logger.ts` — JSON logging to stderr with secret masking
- `src/utils/errors.ts` — toolResult/toolError helpers, KsefApiError class

## Code Conventions

- **ESM only** — `"type": "module"`, use `.js` extensions in imports
- **Strict TypeScript** — `strict: true`, target ES2022, NodeNext
- **Zod for input validation** — schemas parsed with `.parse(args)` in handlers
- **Tool responses** — always return `toolResult(data)` or `toolError(message)`
- **Logging** — use `log("info"|"warn"|"error", message, data?)` — stderr only!
- **Native `fetch()`** — no axios, Node 20+ built-in
- **Secrets** — NEVER expose tokens, keys, or full NIPs in tool responses or logs

## Adding a New Tool

1. Create or edit `src/mcp/{domain}-tools.ts`
2. Define Zod input schema
3. Call `registerTool(definition, handler)` from `./registry.js`
4. Import the file in `src/index.ts` (side-effect import)
5. Build and verify: `npm run build && echo '...' | node dist/index.js`

## KSeF API

- TEST: `https://ksef-test.mf.gov.pl/api`
- DEMO: `https://ksef-demo.mf.gov.pl/api`
- PROD: `https://ksef.mf.gov.pl/api`
- Auth: SessionToken header (not Bearer)
- Schema: FA(3) only (since Feb 2026)

## Tools (9 total)

**Auth:** ksef_env_info, ksef_auth_init, ksef_auth_status, ksef_auth_terminate
**Query:** ksef_invoices_query, ksef_invoice_get, ksef_invoice_status, ksef_invoice_xml, ksef_upo_download
