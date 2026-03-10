import { z } from "zod";
import { registerTool } from "./registry.js";
import { toolResult, toolError } from "../utils/errors.js";
import { log } from "../utils/logger.js";
import { getDraft, lockDraft, setDraftStatus } from "../domain/draft.js";
import { buildInvoiceXml } from "../domain/xml-builder.js";
import { validateDraft } from "../domain/validator.js";
import { sha256hex } from "../infra/ksef/crypto.js";
import { requireSession } from "../infra/ksef/auth.js";
import { config } from "../utils/config.js";
import {
  createApproval,
  confirmApproval,
  getApproval,
  listPendingApprovals,
  findConfirmedApprovalForDraft,
} from "../domain/approval.js";
import { auditLog, hashNip, readAuditLog } from "../domain/audit.js";
import {
  sendEncryptedInvoice,
  openOnlineSession,
  closeOnlineSession,
  getActiveOnlineSession,
} from "../infra/ksef/session.js";

// ─── Schemas ────────────────────────────────────────────────────────────────────

const DraftIdInput = z.object({
  id: z.string().describe("ID draftu (UUID)"),
});

const ApprovalIdInput = z.object({
  approvalId: z.string().describe("ID approval request (UUID)"),
});

const SendInput = z.object({
  draftId: z.string().describe("ID draftu do wysłania (UUID)"),
});

const AuditLogInput = z.object({
  limit: z.number().int().min(1).max(100).optional()
    .describe("Liczba wpisów do pobrania (domyślnie 20, max 100)"),
});

// ─── Helpers ────────────────────────────────────────────────────────────────────

function buildPreviewSummary(draft: ReturnType<typeof getDraft>): string {
  if (!draft) return "(brak draftu)";
  const items = draft.items.length;
  const gross = draft.totalGross?.toFixed(2) ?? "?";
  return (
    `Faktura ${draft.invoiceNumber} z ${draft.issueDate}, ` +
    `${items} poz., brutto ${gross} ${draft.currency}`
  );
}

// ─── Tools ──────────────────────────────────────────────────────────────────────

registerTool(
  {
    name: "ksef_draft_lock",
    description:
      "Zablokuj draft do wysłania. Renderuje XML, oblicza hash SHA-256, " +
      "ustawia status na 'locked'. Draft musi być wcześniej zwalidowany " +
      "(ksef_draft_validate). Po zablokowaniu nie można go edytować.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID draftu (UUID)" },
      },
      required: ["id"],
    },
  },
  async (args) => {
    const startMs = Date.now();
    const input = DraftIdInput.parse(args);
    const draft = getDraft(input.id);
    if (!draft) return toolError(`Draft nie znaleziony: ${input.id}`);

    // Must be validated first
    if (draft.status !== "validated") {
      return toolError(
        `Draft musi mieć status 'validated' aby go zablokować. ` +
        `Aktualny: '${draft.status}'. Użyj ksef_draft_validate.`,
      );
    }

    // Re-validate before locking
    const validation = validateDraft(draft);
    if (!validation.valid) {
      return toolError(
        "Draft nie przeszedł ponownej walidacji:\n" +
        validation.errors.join("\n"),
      );
    }

    // Render XML and compute hash
    const xml = buildInvoiceXml(draft);
    const xmlHash = sha256hex(Buffer.from(xml, "utf-8"));

    // Lock the draft
    const locked = lockDraft(input.id, xmlHash);

    auditLog({
      action: "draft_locked",
      toolName: "ksef_draft_lock",
      nipHash: hashNip(draft.sellerNip),
      draftId: input.id,
      payloadHash: xmlHash,
      status: "success",
      durationMs: Date.now() - startMs,
    });

    log("info", `Draft locked: ${input.id}, xmlHash: ${xmlHash.slice(0, 12)}...`);

    return toolResult({
      status: "draft_zablokowany",
      draftId: locked.id,
      xmlHash,
      lockedAt: locked.lockedAt,
      previewSummary: buildPreviewSummary(locked),
    });
  },
);

registerTool(
  {
    name: "ksef_approval_request",
    description:
      "Utwórz żądanie zatwierdzenia (approval) dla zablokowanego draftu. " +
      "Approval musi być potwierdzone przed wysłaniem faktury do KSeF. " +
      "Wygasa po 15 minutach. Jeśli KSEF_APPROVAL_MODE=auto, zatwierdzenie jest automatyczne.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID zablokowanego draftu (UUID)" },
      },
      required: ["id"],
    },
  },
  async (args) => {
    const startMs = Date.now();
    const input = DraftIdInput.parse(args);
    const draft = getDraft(input.id);
    if (!draft) return toolError(`Draft nie znaleziony: ${input.id}`);

    if (draft.status !== "locked") {
      return toolError(
        `Draft musi mieć status 'locked'. Aktualny: '${draft.status}'. ` +
        "Użyj ksef_draft_lock.",
      );
    }

    if (!draft.xmlHash) {
      return toolError("Draft nie ma hash'a XML. Użyj ksef_draft_lock ponownie.");
    }

    const summary = buildPreviewSummary(draft);
    const approval = createApproval({
      type: "send_invoice",
      draftId: input.id,
      payloadHash: draft.xmlHash,
      previewSummary: summary,
    });

    auditLog({
      action: "approval_created",
      toolName: "ksef_approval_request",
      nipHash: hashNip(draft.sellerNip),
      draftId: input.id,
      approvalId: approval.id,
      payloadHash: draft.xmlHash,
      status: "success",
      durationMs: Date.now() - startMs,
    });

    return toolResult({
      status: approval.status === "confirmed" ? "auto_zatwierdzone" : "oczekuje_na_zatwierdzenie",
      approvalId: approval.id,
      draftId: input.id,
      previewSummary: summary,
      expiresAt: approval.expiresAt,
      approvalMode: config.approvalMode,
      hint: approval.status === "confirmed"
        ? "Approval automatycznie zatwierdzone. Możesz wysłać fakturę: ksef_send_invoice."
        : "Potwierdź zatwierdzenie: ksef_approval_confirm. Wygasa: " + approval.expiresAt,
    });
  },
);

registerTool(
  {
    name: "ksef_approval_confirm",
    description:
      "Potwierdź żądanie zatwierdzenia (approval). " +
      "Weryfikuje, że approval jest aktywne, nie wygasło, i hash się zgadza. " +
      "Po potwierdzeniu faktura jest gotowa do wysłania.",
    inputSchema: {
      type: "object",
      properties: {
        approvalId: { type: "string", description: "ID approval request (UUID)" },
      },
      required: ["approvalId"],
    },
  },
  async (args) => {
    const startMs = Date.now();
    const input = ApprovalIdInput.parse(args);

    const approval = getApproval(input.approvalId);
    if (!approval) return toolError(`Approval nie znalezione: ${input.approvalId}`);

    if (approval.status === "confirmed") {
      return toolResult({
        status: "juz_zatwierdzone",
        approvalId: approval.id,
        confirmedAt: approval.confirmedAt,
      });
    }

    // Get draft to verify hash
    const draft = getDraft(approval.draftId);
    if (!draft) return toolError(`Draft powiązany z approval nie istnieje: ${approval.draftId}`);
    if (!draft.xmlHash) return toolError("Draft nie ma hash'a XML.");

    try {
      const confirmed = confirmApproval(input.approvalId, draft.xmlHash);

      auditLog({
        action: "approval_confirmed",
        toolName: "ksef_approval_confirm",
        nipHash: hashNip(draft.sellerNip),
        draftId: approval.draftId,
        approvalId: confirmed.id,
        payloadHash: confirmed.payloadHash,
        status: "success",
        durationMs: Date.now() - startMs,
      });

      return toolResult({
        status: "zatwierdzone",
        approvalId: confirmed.id,
        draftId: confirmed.draftId,
        confirmedAt: confirmed.confirmedAt,
        hint: "Faktura gotowa do wysłania. Użyj ksef_send_invoice.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      auditLog({
        action: "approval_confirm_failed",
        toolName: "ksef_approval_confirm",
        nipHash: hashNip(draft.sellerNip),
        draftId: approval.draftId,
        approvalId: input.approvalId,
        status: "error",
        details: msg,
        durationMs: Date.now() - startMs,
      });

      return toolError(msg);
    }
  },
);

registerTool(
  {
    name: "ksef_send_invoice",
    description:
      "Wyślij zablokowaną i zatwierdzoną fakturę do KSeF. " +
      "Wymaga: aktywnej sesji KSeF, draftu w statusie 'locked', " +
      "potwierdzonego approval z pasującym hashem XML. " +
      "Szyfruje XML (AES-256-CBC + RSA-OAEP) i wysyła do API KSeF.",
    inputSchema: {
      type: "object",
      properties: {
        draftId: { type: "string", description: "ID draftu do wysłania (UUID)" },
      },
      required: ["draftId"],
    },
    annotations: { destructiveHint: true },
  },
  async (args) => {
    const startMs = Date.now();
    const input = SendInput.parse(args);

    // 1. Verify session
    const session = requireSession();

    // 2. Verify draft
    const draft = getDraft(input.draftId);
    if (!draft) return toolError(`Draft nie znaleziony: ${input.draftId}`);

    if (draft.status !== "locked") {
      return toolError(
        `Draft musi mieć status 'locked'. Aktualny: '${draft.status}'. ` +
        "Użyj ksef_draft_lock.",
      );
    }

    if (!draft.xmlHash) {
      return toolError("Draft nie ma hash'a XML. Użyj ksef_draft_lock ponownie.");
    }

    // 3. Find confirmed approval for this draft
    listPendingApprovals(); // clean up expired as side-effect
    const approval = findConfirmedApprovalForDraft(input.draftId, draft.xmlHash);

    if (!approval) {
      return toolError(
        "Brak potwierdzonego approval dla tego draftu. " +
        "Użyj ksef_approval_request i ksef_approval_confirm.",
      );
    }

    // 4. CRITICAL: Verify hash match between draft and approval
    if (approval.payloadHash !== draft.xmlHash) {
      auditLog({
        action: "send_hash_mismatch",
        toolName: "ksef_send_invoice",
        nipHash: hashNip(draft.sellerNip),
        draftId: input.draftId,
        approvalId: approval.id,
        payloadHash: draft.xmlHash,
        status: "error",
        details: `Draft hash: ${draft.xmlHash}, approval hash: ${approval.payloadHash}`,
        durationMs: Date.now() - startMs,
      });

      return toolError(
        "BEZPIECZEŃSTWO: Hash XML draftu nie zgadza się z hashem w approval. " +
        "Draft mógł zostać zmodyfikowany. Utwórz nowe approval.",
      );
    }

    // 5. Render XML (must produce same hash)
    const xml = buildInvoiceXml(draft);
    const currentHash = sha256hex(Buffer.from(xml, "utf-8"));

    if (currentHash !== draft.xmlHash) {
      auditLog({
        action: "send_xml_changed",
        toolName: "ksef_send_invoice",
        nipHash: hashNip(draft.sellerNip),
        draftId: input.draftId,
        approvalId: approval.id,
        payloadHash: currentHash,
        status: "error",
        details: `Locked hash: ${draft.xmlHash}, current hash: ${currentHash}`,
        durationMs: Date.now() - startMs,
      });

      return toolError(
        "XML faktury zmienił się od momentu zablokowania draftu. " +
        "Odblokuj, zwaliduj i zablokuj ponownie.",
      );
    }

    // 6. Open online session if not already open
    let onlineSession = getActiveOnlineSession();
    let sessionOpened = false;
    if (!onlineSession) {
      try {
        onlineSession = await openOnlineSession(session.accessToken);
        sessionOpened = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`Błąd otwierania sesji online: ${msg}`);
      }
    }

    // 7. Send to KSeF
    try {
      const result = await sendEncryptedInvoice(session.accessToken, xml, onlineSession);

      // Update draft status
      setDraftStatus(input.draftId, "sent", {
        ksefReferenceNumber: result.referenceNumber,
        sentAt: new Date().toISOString(),
      });

      auditLog({
        action: "invoice_sent",
        toolName: "ksef_send_invoice",
        nipHash: hashNip(draft.sellerNip),
        draftId: input.draftId,
        approvalId: approval.id,
        ksefReferenceNumber: result.referenceNumber,
        payloadHash: draft.xmlHash,
        status: "success",
        durationMs: Date.now() - startMs,
      });

      log("info", `Invoice sent: draft=${input.draftId}, ref=${result.referenceNumber}`);

      return toolResult({
        status: "faktura_wyslana",
        draftId: input.draftId,
        invoiceReferenceNumber: result.referenceNumber,
        sessionReferenceNumber: onlineSession.referenceNumber,
        sentAt: new Date().toISOString(),
        hint: "Sprawdź status przetwarzania: ksef_invoice_status",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // Mark draft as error
      setDraftStatus(input.draftId, "error", {
        errorMessage: msg,
      });

      auditLog({
        action: "invoice_send_failed",
        toolName: "ksef_send_invoice",
        nipHash: hashNip(draft.sellerNip),
        draftId: input.draftId,
        approvalId: approval.id,
        payloadHash: draft.xmlHash,
        status: "error",
        details: msg,
        durationMs: Date.now() - startMs,
      });

      return toolError(`Błąd wysyłania faktury do KSeF: ${msg}`);
    }
  },
);

registerTool(
  {
    name: "ksef_audit_log",
    description:
      "Wyświetl ostatnie wpisy z logu audytowego. " +
      "Log zawiera wszystkie operacje: tworzenie draftów, zatwierdzenia, wysyłki. " +
      "NIP-y są zahashowane (SHA-256) dla bezpieczeństwa.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Liczba wpisów do pobrania (domyślnie 20, max 100)",
        },
      },
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const input = AuditLogInput.parse(args);
    const entries = readAuditLog(input.limit ?? 20);
    return toolResult({
      count: entries.length,
      entries,
    });
  },
);

