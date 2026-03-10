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
- `src/infra/ksef/client.ts` — HTTP client for KSeF API v2 (fetch + timeout + Bearer JWT auth)
- `src/infra/ksef/auth.ts` — Auth flow v2: challenge → ksef-token → token/redeem → JWT access + refresh
- `src/infra/ksef/crypto.ts` — RSA-OAEP, AES-256-CBC, SHA-256/Base64, public key certs
- `src/infra/ksef/session.ts` — Online session: open, send encrypted invoices, close, status, UPO
- `src/infra/ksef/batch.ts` — Batch session: open (pre-signed URLs), upload parts, close, status
- `src/infra/ksef/token-client.ts` — KSeF token management: generate, list, get, revoke
- `src/utils/config.ts` — Environment variables, base URLs (v2), data dirs
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

## KSeF API v2

- TEST: `https://api-test.ksef.mf.gov.pl/v2`
- DEMO: `https://api-demo.ksef.mf.gov.pl/v2`
- PROD: `https://api.ksef.mf.gov.pl/v2`
- Auth: `Authorization: Bearer {JWT}` (access token from redeem flow)
- Token refresh: `POST /auth/token/refresh` with refresh token
- Schema: FA(3) `1-0E`, PEF(3) `2-1`
- OpenAPI spec: `openapi.json` (v2.2.0)

## Auth Flow (v2 — JWT-based)

1. `POST /auth/challenge` → get `{ challenge, timestamp, timestampMs }`
2. `POST /auth/ksef-token` → encrypt `token|timestampMs` with RSA-OAEP → get `authenticationToken` (JWT)
3. `POST /auth/token/redeem` → Bearer: authToken → get `{ accessToken, refreshToken }` (JWTs)
4. Use `Authorization: Bearer {accessToken}` for all API calls
5. `POST /auth/token/refresh` → Bearer: refreshToken → get new accessToken
6. `DELETE /auth/sessions/current` → terminate session

## Tools (30 total)

**Auth:** ksef_env_info, ksef_auth_init, ksef_auth_status, ksef_auth_terminate
**Query:** ksef_invoices_query, ksef_invoice_get, ksef_invoice_status, ksef_invoice_xml, ksef_upo_download
**Draft:** ksef_draft_create, ksef_draft_get, ksef_draft_list, ksef_draft_update, ksef_draft_delete, ksef_draft_validate, ksef_draft_render_xml
**Send:** ksef_draft_lock, ksef_approval_request, ksef_approval_confirm, ksef_send_invoice, ksef_audit_log
**Correction:** ksef_correction_create
**Batch:** ksef_batch_open, ksef_batch_send_part, ksef_batch_close, ksef_batch_status
**Token:** ksef_token_generate, ksef_token_list, ksef_token_get, ksef_token_revoke

## Invoice Send Flow (v2)

1. `ksef_auth_init` — Authenticate (challenge → ksef-token → redeem)
2. `ksef_draft_create` — Create invoice draft
3. `ksef_draft_validate` — Validate against FA(3) rules
4. `ksef_draft_lock` — Lock draft, compute XML hash
5. `ksef_approval_request` — Request approval (auto-confirmed if KSEF_APPROVAL_MODE=auto)
6. `ksef_approval_confirm` — Confirm approval (manual mode)
7. `ksef_send_invoice` — Auto-opens online session, encrypts XML (AES-256-CBC), sends to KSeF
8. `ksef_audit_log` — View audit trail

**Online session**: automatically opened on first send, AES key generated per session.

## Correction Flow

1. `ksef_correction_create` — Clone sent invoice as correction draft (with reason)
2. `ksef_draft_update` — Modify correction line items
3. Follow standard send flow (validate → lock → approval → send)

## Batch Flow (v2 — pre-signed URLs)

1. `ksef_batch_open` — Open batch session with file metadata → get pre-signed upload URLs
2. `ksef_batch_send_part` — Upload encrypted parts to pre-signed URLs
3. `ksef_batch_close` — Close batch session
4. `ksef_batch_status` — Check processing status (GET /sessions/{ref})

## Token Management

1. `ksef_token_generate` — Generate new KSeF token (v2 returns token value)
2. `ksef_token_list` — List tokens (continuation token pagination)
3. `ksef_token_get` — Get token details
4. `ksef_token_revoke` — Revoke token (requires approval gate)

Permissions: `InvoiceRead`, `InvoiceWrite`, `CredentialsRead`, `CredentialsManage`, `SubunitManage`, `EnforcementOperations`, `Introspection`

## API Endpoint Mapping (v1 → v2)

| v1 (old) | v2 (current) |
|---|---|
| `POST /online/Session/AuthorisationChallenge` | `POST /auth/challenge` |
| `POST /online/Session/InitToken` | `POST /auth/ksef-token` + `POST /auth/token/redeem` |
| `GET /online/Session/Status/{ref}` | `GET /auth/{ref}` |
| `GET /online/Session/Terminate` | `DELETE /auth/sessions/current` |
| `POST /online/Query/Invoice/Sync` | `POST /invoices/query/metadata` |
| `GET /online/Invoice/Get/{ref}` | `GET /invoices/ksef/{ksefNumber}` |
| `GET /online/Invoice/Status/{ref}` | `GET /sessions/{sessionRef}/invoices/{invoiceRef}` |
| `POST /online/Invoice/Send` | `POST /sessions/online/{ref}/invoices` |
| — | `POST /sessions/online` (new: open online session) |
| — | `POST /sessions/online/{ref}/close` (new: close online session) |
| `POST /online/Session/InitBatch` | `POST /sessions/batch` |
| `POST /online/Session/SendBatch/{ref}/Parts/{n}` | Pre-signed URLs from batch open response |
| `POST /online/Session/TerminateBatch/{ref}` | `POST /sessions/batch/{ref}/close` |
| `GET /online/Session/StatusBatch/{ref}` | `GET /sessions/{ref}` |
| `POST /online/Credentials/GenerateToken` | `POST /tokens` |
| `GET /online/Credentials/CredentialsList` | `GET /tokens` |
| `GET /online/Credentials/Status/{ref}` | `GET /tokens/{ref}` |
| `DELETE /online/Credentials/Revoke/{ref}` | `DELETE /tokens/{ref}` |
| `GET .../AuthorisationChallenge/PublicKey` | `GET /security/public-key-certificates` |
