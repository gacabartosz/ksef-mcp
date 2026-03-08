import { z } from "zod";
import { registerTool } from "./registry.js";
import { toolResult, toolError } from "../utils/errors.js";
import { getDraft } from "../domain/draft.js";
import { cloneAsCorrection } from "../domain/correction.js";
import { auditLog, hashNip } from "../domain/audit.js";

// ─── Schemas ────────────────────────────────────────────────────────────────────

const CorrectionCreateInput = z.object({
  originalDraftId: z.string().describe("ID oryginalnego draftu (UUID) — musi być wysłany do KSeF"),
  correctionReason: z.string().min(3).describe("Powód korekty (min. 3 znaki)"),
});

// ─── Tools ──────────────────────────────────────────────────────────────────────

registerTool(
  {
    name: "ksef_correction_create",
    description:
      "Utwórz korektę faktury na podstawie istniejącego draftu. " +
      "Oryginalna faktura musi być wysłana do KSeF (mieć ksefReferenceNumber). " +
      "Tworzy nowy draft z danymi oryginału, statusem 'draft' i powiązaniem z oryginałem.",
    inputSchema: {
      type: "object",
      properties: {
        originalDraftId: {
          type: "string",
          description: "ID oryginalnego draftu (UUID) — musi być wysłany do KSeF",
        },
        correctionReason: {
          type: "string",
          description: "Powód korekty (min. 3 znaki)",
        },
      },
      required: ["originalDraftId", "correctionReason"],
    },
  },
  async (args) => {
    const startMs = Date.now();
    const input = CorrectionCreateInput.parse(args);

    // Verify original exists
    const original = getDraft(input.originalDraftId);
    if (!original) {
      return toolError(`Draft nie znaleziony: ${input.originalDraftId}`);
    }

    if (!original.ksefReferenceNumber) {
      return toolError(
        "Oryginalna faktura nie została wysłana do KSeF (brak ksefReferenceNumber). " +
        "Korektę można wystawić tylko do wysłanej faktury.",
      );
    }

    try {
      const correction = cloneAsCorrection(input.originalDraftId, input.correctionReason);

      auditLog({
        action: "correction_created",
        toolName: "ksef_correction_create",
        nipHash: hashNip(original.sellerNip),
        draftId: correction.id,
        ksefReferenceNumber: original.ksefReferenceNumber,
        status: "success",
        details: `Korekta do: ${input.originalDraftId}, powód: ${input.correctionReason}`,
        durationMs: Date.now() - startMs,
      });

      return toolResult({
        status: "korekta_utworzona",
        correctionDraftId: correction.id,
        originalDraftId: input.originalDraftId,
        originalKsefRef: original.ksefReferenceNumber,
        correctionReason: input.correctionReason,
        invoiceNumber: correction.invoiceNumber,
        totalGross: correction.totalGross,
        hint: "Edytuj pozycje korekty (ksef_draft_update), zwaliduj i wyślij standardowym flow.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      auditLog({
        action: "correction_create_failed",
        toolName: "ksef_correction_create",
        nipHash: hashNip(original.sellerNip),
        draftId: input.originalDraftId,
        status: "error",
        details: msg,
        durationMs: Date.now() - startMs,
      });

      return toolError(msg);
    }
  },
);
