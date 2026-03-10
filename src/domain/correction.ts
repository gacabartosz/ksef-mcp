import { getDraft, createDraft, type DraftInvoice, type InvoiceItem } from "./draft.js";
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

// ─── Zeroing Correction from KSeF Data ──────────────────────────────────────

export interface KsefInvoiceData {
  ksefNumber: string;          // KSeF reference number
  invoiceNumber: string;       // Original invoice number
  issueDate: string;           // Original issue date (YYYY-MM-DD)
  sellDate?: string;           // Original sell date
  sellerNip: string;
  sellerName: string;
  sellerAddress?: string;
  buyerNip: string;
  buyerName: string;
  buyerAddress?: string;
  currency: string;
  exchangeRate?: number;       // PLN per 1 unit of foreign currency (for P_14_xW)
  items: { name: string; quantity: number; unitPrice: number; vatRate: number; unit?: string }[];
}

/**
 * Create a zeroing correction draft from KSeF invoice data.
 * Does NOT require a local draft of the original invoice.
 *
 * Creates a new draft with:
 * - items with quantity=0 (zeroed)
 * - originalItems with original quantities (for StanPrzed in XML)
 * - originalKsefRef, originalInvoiceNumber, originalIssueDate
 * - isZeroingCorrection = true
 */
export function createZeroingCorrectionFromKsef(
  data: KsefInvoiceData,
  correctionReason: string,
): DraftInvoice {
  const originalItems: InvoiceItem[] = data.items.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    vatRate: item.vatRate,
    unit: item.unit,
  }));

  const zeroedItems: InvoiceItem[] = data.items.map((item) => ({
    name: item.name,
    quantity: 0,
    unitPrice: item.unitPrice,
    vatRate: item.vatRate,
    unit: item.unit,
  }));

  const correctionDraft = createDraft({
    sellerNip: data.sellerNip,
    sellerName: data.sellerName,
    sellerAddress: data.sellerAddress,
    buyerNip: data.buyerNip,
    buyerName: data.buyerName,
    buyerAddress: data.buyerAddress,
    invoiceNumber: `KOR 1 ${data.invoiceNumber}`,
    issueDate: new Date().toISOString().slice(0, 10),
    sellDate: data.sellDate,
    currency: data.currency || "PLN",
    items: zeroedItems,
    originalItems,
    originalKsefRef: data.ksefNumber,
    originalInvoiceNumber: data.invoiceNumber,
    originalIssueDate: data.issueDate,
    correctionReason,
    isZeroingCorrection: true,
    exchangeRate: data.exchangeRate,
  });

  log("info", `Zeroing correction draft created: ${correctionDraft.id} for KSeF invoice: ${data.ksefNumber}`);
  return correctionDraft;
}
