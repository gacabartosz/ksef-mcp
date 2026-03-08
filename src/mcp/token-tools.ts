import { z } from "zod";
import { registerTool } from "./registry.js";
import { toolResult, toolError } from "../utils/errors.js";
import { requireSession } from "../infra/ksef/auth.js";
import { sha256hex } from "../infra/ksef/crypto.js";
import { auditLog, hashNip } from "../domain/audit.js";
import {
  createApproval,
  findConfirmedApprovalForDraft,
  listPendingApprovals,
} from "../domain/approval.js";
import {
  generateKsefToken,
  listKsefTokens,
  getKsefToken,
  revokeKsefToken,
} from "../infra/ksef/token-client.js";

// ─── Schemas ────────────────────────────────────────────────────────────────────

const TokenGenerateInput = z.object({
  description: z.string().min(1).describe("Opis tokena (do identyfikacji)"),
  permissions: z.array(z.string()).min(1).describe("Lista uprawnień, np. ['read', 'write']"),
});

const TokenListInput = z.object({
  pageSize: z.number().int().min(1).max(100).optional().describe("Rozmiar strony (domyślnie wg API)"),
  pageOffset: z.number().int().min(0).optional().describe("Offset strony (od 0)"),
});

const TokenRefInput = z.object({
  referenceNumber: z.string().describe("Numer referencyjny tokena"),
});

// ─── Tools ──────────────────────────────────────────────────────────────────────

registerTool(
  {
    name: "ksef_token_generate",
    description:
      "Wygeneruj nowy token KSeF. Wymaga aktywnej sesji KSeF. " +
      "Zwraca numer referencyjny — NIE wartość tokena (nigdy nie eksponujemy sekretów). " +
      "Token jest dostarczany przez KSeF osobnym kanałem.",
    inputSchema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description: "Opis tokena (do identyfikacji)",
        },
        permissions: {
          type: "array",
          items: { type: "string" },
          description: "Lista uprawnień, np. ['read', 'write']",
        },
      },
      required: ["description", "permissions"],
    },
  },
  async (args) => {
    const startMs = Date.now();
    const input = TokenGenerateInput.parse(args);
    const session = requireSession();

    try {
      const result = await generateKsefToken(session.token, {
        description: input.description,
        permissions: input.permissions,
      });

      auditLog({
        action: "token_generated",
        toolName: "ksef_token_generate",
        nipHash: hashNip(session.nip),
        ksefReferenceNumber: result.referenceNumber,
        status: "success",
        details: `description: ${input.description}`,
        durationMs: Date.now() - startMs,
      });

      return toolResult({
        status: "token_wygenerowany",
        referenceNumber: result.referenceNumber,
        processingCode: result.processingCode,
        processingDescription: result.processingDescription,
        hint: "Token jest dostarczany przez KSeF. Użyj ksef_token_get aby sprawdzić status.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      auditLog({
        action: "token_generate_failed",
        toolName: "ksef_token_generate",
        nipHash: hashNip(session.nip),
        status: "error",
        details: msg,
        durationMs: Date.now() - startMs,
      });

      return toolError(`Błąd generowania tokena: ${msg}`);
    }
  },
);

registerTool(
  {
    name: "ksef_token_list",
    description:
      "Wyświetl listę tokenów KSeF. Wymaga aktywnej sesji. " +
      "Zwraca metadane — nigdy wartości tokenów.",
    inputSchema: {
      type: "object",
      properties: {
        pageSize: {
          type: "number",
          description: "Rozmiar strony (domyślnie wg API)",
        },
        pageOffset: {
          type: "number",
          description: "Offset strony (od 0)",
        },
      },
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const input = TokenListInput.parse(args);
    const session = requireSession();

    try {
      const result = await listKsefTokens(session.token, {
        pageSize: input.pageSize,
        pageOffset: input.pageOffset,
      });

      return toolResult({
        status: "lista_tokenow",
        credentials: result.credentials,
        numberOfElements: result.numberOfElements,
        pageSize: result.pageSize,
        pageOffset: result.pageOffset,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(`Błąd pobierania listy tokenów: ${msg}`);
    }
  },
);

registerTool(
  {
    name: "ksef_token_get",
    description:
      "Pobierz szczegóły tokena KSeF. Wymaga aktywnej sesji. " +
      "Zwraca metadane — nigdy wartość tokena.",
    inputSchema: {
      type: "object",
      properties: {
        referenceNumber: {
          type: "string",
          description: "Numer referencyjny tokena",
        },
      },
      required: ["referenceNumber"],
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const input = TokenRefInput.parse(args);
    const session = requireSession();

    try {
      const result = await getKsefToken(session.token, input.referenceNumber);

      return toolResult({
        status: "szczegoly_tokena",
        referenceNumber: result.referenceNumber,
        description: result.description,
        credentialStatus: result.credentialStatus,
        createdAt: result.createdAt,
        lastUsedAt: result.lastUsedAt,
        permissions: result.permissions,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(`Błąd pobierania szczegółów tokena: ${msg}`);
    }
  },
);

registerTool(
  {
    name: "ksef_token_revoke",
    description:
      "Unieważnij token KSeF. OPERACJA NIEODWRACALNA. " +
      "Wymaga aktywnej sesji i potwierdzonego approval. " +
      "Token po unieważnieniu nie może być przywrócony.",
    inputSchema: {
      type: "object",
      properties: {
        referenceNumber: {
          type: "string",
          description: "Numer referencyjny tokena do unieważnienia",
        },
      },
      required: ["referenceNumber"],
    },
    annotations: { destructiveHint: true },
  },
  async (args) => {
    const startMs = Date.now();
    const input = TokenRefInput.parse(args);
    const session = requireSession();

    // Use referenceNumber as "draftId" for approval gate
    const approvalDraftId = `token:${input.referenceNumber}`;
    const payloadHash = sha256hex(Buffer.from(input.referenceNumber));

    // Check for confirmed approval
    listPendingApprovals(); // clean up expired as side-effect
    const approval = findConfirmedApprovalForDraft(approvalDraftId, payloadHash);

    if (!approval) {
      // Create a new approval request
      const newApproval = createApproval({
        type: "revoke_token",
        draftId: approvalDraftId,
        payloadHash,
        previewSummary: `Unieważnienie tokena KSeF: ${input.referenceNumber}`,
      });

      auditLog({
        action: "token_revoke_approval_created",
        toolName: "ksef_token_revoke",
        nipHash: hashNip(session.nip),
        approvalId: newApproval.id,
        ksefReferenceNumber: input.referenceNumber,
        status: "success",
        durationMs: Date.now() - startMs,
      });

      if (newApproval.status === "confirmed") {
        // Auto-confirmed — proceed with revocation below
      } else {
        return toolResult({
          status: "wymaga_zatwierdzenia",
          approvalId: newApproval.id,
          referenceNumber: input.referenceNumber,
          expiresAt: newApproval.expiresAt,
          hint: "Potwierdź zatwierdzenie: ksef_approval_confirm, następnie ponów ksef_token_revoke.",
        });
      }
    }

    // Approval confirmed — proceed with revocation
    try {
      const result = await revokeKsefToken(session.token, input.referenceNumber);

      auditLog({
        action: "token_revoked",
        toolName: "ksef_token_revoke",
        nipHash: hashNip(session.nip),
        ksefReferenceNumber: input.referenceNumber,
        status: "success",
        durationMs: Date.now() - startMs,
      });

      return toolResult({
        status: "token_uniewaziony",
        referenceNumber: result.referenceNumber,
        processingCode: result.processingCode,
        processingDescription: result.processingDescription,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      auditLog({
        action: "token_revoke_failed",
        toolName: "ksef_token_revoke",
        nipHash: hashNip(session.nip),
        ksefReferenceNumber: input.referenceNumber,
        status: "error",
        details: msg,
        durationMs: Date.now() - startMs,
      });

      return toolError(`Błąd unieważniania tokena: ${msg}`);
    }
  },
);
