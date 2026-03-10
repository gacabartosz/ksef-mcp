import { z } from "zod";
import { registerTool } from "./registry.js";
import { toolResult, toolError } from "../utils/errors.js";
import { getDraft } from "../domain/draft.js";
import { cloneAsCorrection, createZeroingCorrectionFromKsef } from "../domain/correction.js";
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

// ─── Zeroing Correction from KSeF ───────────────────────────────────────────

const CorrectionZeroInput = z.object({
  ksefNumber: z.string().describe("Numer KSeF faktury korygowanej"),
  invoiceNumber: z.string().describe("Numer oryginalnej faktury"),
  issueDate: z.string().describe("Data wystawienia oryginału (YYYY-MM-DD)"),
  sellDate: z.string().optional().describe("Data sprzedaży oryginału (YYYY-MM-DD)"),
  sellerNip: z.string().describe("NIP sprzedawcy"),
  sellerName: z.string().describe("Nazwa sprzedawcy"),
  sellerAddress: z.string().optional().describe("Adres sprzedawcy"),
  buyerNip: z.string().describe("NIP nabywcy"),
  buyerName: z.string().describe("Nazwa nabywcy"),
  buyerAddress: z.string().optional().describe("Adres nabywcy"),
  currency: z.string().optional().describe("Waluta (domyślnie PLN)"),
  exchangeRate: z.number().positive().optional().describe("Kurs waluty (PLN za 1 jednostkę) — wymagany dla faktur walutowych, generuje P_14_xW"),
  forcedVatPln: z.record(z.string(), z.number()).optional().describe("Ręczne nadpisanie P_14_xW wg stawki, np. {\"1\": -3197.74} → P_14_1W=-3197.74. Używaj dla KOR-do-KOR."),
  correctionReason: z.string().min(3).describe("Powód korekty (min. 3 znaki)"),
  items: z.array(z.object({
    name: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
    vatRate: z.number(),
    unit: z.string().optional(),
  })).describe("Pozycje oryginalnej faktury"),
});

registerTool(
  {
    name: "ksef_correction_zero",
    description:
      "Utwórz korektę zerującą na podstawie danych faktury z KSeF. " +
      "Zeruje wszystkie pozycje (ilość → 0). Nie wymaga lokalnego draftu oryginału.",
    inputSchema: {
      type: "object",
      properties: {
        ksefNumber: {
          type: "string",
          description: "Numer KSeF faktury korygowanej",
        },
        invoiceNumber: {
          type: "string",
          description: "Numer oryginalnej faktury",
        },
        issueDate: {
          type: "string",
          description: "Data wystawienia oryginału (YYYY-MM-DD)",
        },
        sellDate: {
          type: "string",
          description: "Data sprzedaży oryginału (YYYY-MM-DD)",
        },
        sellerNip: {
          type: "string",
          description: "NIP sprzedawcy",
        },
        sellerName: {
          type: "string",
          description: "Nazwa sprzedawcy",
        },
        sellerAddress: {
          type: "string",
          description: "Adres sprzedawcy",
        },
        buyerNip: {
          type: "string",
          description: "NIP nabywcy",
        },
        buyerName: {
          type: "string",
          description: "Nazwa nabywcy",
        },
        buyerAddress: {
          type: "string",
          description: "Adres nabywcy",
        },
        currency: {
          type: "string",
          description: "Waluta (domyślnie PLN)",
        },
        exchangeRate: {
          type: "number",
          description: "Kurs waluty (PLN za 1 jednostkę) — wymagany dla faktur walutowych, generuje P_14_xW",
        },
        forcedVatPln: {
          type: "object",
          description: "Ręczne nadpisanie P_14_xW wg stawki VAT, np. {\"1\": -3197.74} → P_14_1W=-3197.74. Dla KOR-do-KOR.",
        },
        correctionReason: {
          type: "string",
          description: "Powód korekty (min. 3 znaki)",
        },
        items: {
          type: "array",
          description: "Pozycje oryginalnej faktury",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              quantity: { type: "number" },
              unitPrice: { type: "number" },
              vatRate: { type: "number" },
              unit: { type: "string" },
            },
            required: ["name", "quantity", "unitPrice", "vatRate"],
          },
        },
      },
      required: [
        "ksefNumber",
        "invoiceNumber",
        "issueDate",
        "sellerNip",
        "sellerName",
        "buyerNip",
        "buyerName",
        "correctionReason",
        "items",
      ],
    },
  },
  async (args) => {
    const startMs = Date.now();
    const input = CorrectionZeroInput.parse(args);

    try {
      const correction = createZeroingCorrectionFromKsef(
        {
          ksefNumber: input.ksefNumber,
          invoiceNumber: input.invoiceNumber,
          issueDate: input.issueDate,
          sellDate: input.sellDate,
          sellerNip: input.sellerNip,
          sellerName: input.sellerName,
          sellerAddress: input.sellerAddress,
          buyerNip: input.buyerNip,
          buyerName: input.buyerName,
          buyerAddress: input.buyerAddress,
          currency: input.currency || "PLN",
          exchangeRate: input.exchangeRate,
          forcedVatPln: input.forcedVatPln,
          items: input.items,
        },
        input.correctionReason,
      );

      auditLog({
        action: "zeroing_correction_created",
        toolName: "ksef_correction_zero",
        nipHash: hashNip(input.sellerNip),
        draftId: correction.id,
        ksefReferenceNumber: input.ksefNumber,
        status: "success",
        details: `Korekta zerująca do KSeF: ${input.ksefNumber}, powód: ${input.correctionReason}`,
        durationMs: Date.now() - startMs,
      });

      return toolResult({
        status: "korekta_zerujaca_utworzona",
        correctionDraftId: correction.id,
        originalKsefRef: input.ksefNumber,
        originalInvoiceNumber: input.invoiceNumber,
        correctionReason: input.correctionReason,
        invoiceNumber: correction.invoiceNumber,
        totalGross: correction.totalGross,
        itemsCount: input.items.length,
        hint: "Zwaliduj (ksef_draft_validate), renderuj XML (ksef_draft_render_xml) i wyślij standardowym flow.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      auditLog({
        action: "zeroing_correction_failed",
        toolName: "ksef_correction_zero",
        nipHash: hashNip(input.sellerNip),
        status: "error",
        details: msg,
        durationMs: Date.now() - startMs,
      });

      return toolError(msg);
    }
  },
);
