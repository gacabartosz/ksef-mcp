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
- `src/mcp/draft-tools.ts` — Draft tools: ksef_draft_create, ksef_draft_get, ksef_draft_list, ksef_draft_update, ksef_draft_delete, ksef_draft_validate, ksef_draft_render_xml
- `src/mcp/send-tools.ts` — Send tools: ksef_draft_lock, ksef_approval_request, ksef_approval_confirm, ksef_send_invoice, ksef_audit_log
- `src/mcp/correction-tools.ts` — Correction tools: ksef_correction_create
- `src/mcp/batch-tools.ts` — Batch tools: ksef_batch_open, ksef_batch_send_part, ksef_batch_close, ksef_batch_status
- `src/mcp/token-tools.ts` — Token tools: ksef_token_generate, ksef_token_list, ksef_token_get, ksef_token_revoke
- `src/domain/draft.ts` — Draft invoice CRUD, totals computation, status management (+ correction fields)
- `src/domain/validator.ts` — FA(3) validation: NIP checksum, dates, VAT rates, totals
- `src/domain/xml-builder.ts` — FA(3) XML builder using fast-xml-parser
- `src/domain/approval.ts` — Two-phase approval gate: create, confirm, cancel, expiry (15min TTL)
- `src/domain/correction.ts` — Invoice correction: cloneAsCorrection (clone sent invoice as new draft)
- `src/domain/audit.ts` — Append-only JSONL audit log with hashed NIPs
- `src/infra/ksef/client.ts` — HTTP client for KSeF API (fetch + timeout + error mapping)
- `src/infra/ksef/auth.ts` — Auth flow: challenge, initTokenSession, getSessionStatus, terminateSession
- `src/infra/ksef/crypto.ts` — RSA-OAEP, AES-256-CBC, SHA-256
- `src/infra/ksef/session.ts` — Online session: encrypted invoice sending, processing status
- `src/infra/ksef/batch.ts` — Batch session: open, send parts, close, status
- `src/infra/ksef/token-client.ts` — KSeF token management: generate, list, get, revoke
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

## Tools (30 total)

**Auth:** ksef_env_info, ksef_auth_init, ksef_auth_status, ksef_auth_terminate
**Query:** ksef_invoices_query, ksef_invoice_get, ksef_invoice_status, ksef_invoice_xml, ksef_upo_download
**Draft:** ksef_draft_create, ksef_draft_get, ksef_draft_list, ksef_draft_update, ksef_draft_delete, ksef_draft_validate, ksef_draft_render_xml
**Send:** ksef_draft_lock, ksef_approval_request, ksef_approval_confirm, ksef_send_invoice, ksef_audit_log
**Correction:** ksef_correction_create
**Batch:** ksef_batch_open, ksef_batch_send_part, ksef_batch_close, ksef_batch_status
**Token:** ksef_token_generate, ksef_token_list, ksef_token_get, ksef_token_revoke

## Invoice Send Flow

1. `ksef_draft_create` — Create invoice draft
2. `ksef_draft_validate` — Validate against FA(3) rules
3. `ksef_draft_lock` — Lock draft, compute XML hash
4. `ksef_approval_request` — Request approval (auto-confirmed if KSEF_APPROVAL_MODE=auto)
5. `ksef_approval_confirm` — Confirm approval (manual mode)
6. `ksef_send_invoice` — Encrypt and send to KSeF
7. `ksef_audit_log` — View audit trail

## Correction Flow

1. `ksef_correction_create` — Clone sent invoice as correction draft (with reason)
2. `ksef_draft_update` — Modify correction line items
3. Follow standard send flow (validate → lock → approval → send)

## Batch Flow

1. `ksef_batch_open` — Open batch session
2. `ksef_batch_send_part` — Send encrypted ZIP parts (1..N)
3. `ksef_batch_close` — Close batch session
4. `ksef_batch_status` — Check processing status

## Token Management

1. `ksef_token_generate` — Generate new KSeF token (returns ref, NOT secret)
2. `ksef_token_list` — List tokens (metadata only)
3. `ksef_token_get` — Get token details (metadata only)
4. `ksef_token_revoke` — Revoke token (requires approval gate)
