import { randomUUID } from "node:crypto";
import { getDraft, createDraft, type DraftInvoice } from "./draft.js";
import { log } from "../utils/logger.js";

// ─── Correction Support ─────────────────────────────────────────────────────

/**
 * Clone an existing draft as a correction invoice.
 * The original must have been sent (have a ksefReferenceNumber).
 *
 * Creates a new draft with:
 * - New UUID, status 'draft'
 * - correctionOf → original draft ID
 * - correctionReason → provided reason
 * - originalKsefRef → original KSeF reference number
 */
export function cloneAsCorrection(
  originalDraftId: string,
  correctionReason: string,
): DraftInvoice {
  const original = getDraft(originalDraftId);
  if (!original) {
    throw new Error(`Draft nie znaleziony: ${originalDraftId}`);
  }

  if (!original.ksefReferenceNumber) {
    throw new Error(
      "Oryginalna faktura nie została wysłana do KSeF (brak ksefReferenceNumber). " +
      "Korektę można wystawić tylko do wysłanej faktury.",
    );
  }

  const correctionDraft = createDraft({
    sellerNip: original.sellerNip,
    sellerName: original.sellerName,
    sellerAddress: original.sellerAddress,
    buyerNip: original.buyerNip,
    buyerName: original.buyerName,
    buyerAddress: original.buyerAddress,
    invoiceNumber: `${original.invoiceNumber}/KOR`,
    issueDate: new Date().toISOString().slice(0, 10),
    sellDate: original.sellDate,
    currency: original.currency,
    items: original.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      vatRate: item.vatRate,
      unit: item.unit,
    })),
    correctionOf: originalDraftId,
    correctionReason,
    originalKsefRef: original.ksefReferenceNumber,
  });

  log("info", `Correction draft created: ${correctionDraft.id} for original: ${originalDraftId}`);
  return correctionDraft;
}
