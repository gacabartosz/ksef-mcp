import { z } from "zod";
import { registerTool } from "./registry.js";
import { toolResult, toolError } from "../utils/errors.js";
import { log } from "../utils/logger.js";
import { createDraft, getDraft, listDrafts, updateDraft, deleteDraft, setDraftStatus } from "../domain/draft.js";
import type { DraftInvoice } from "../domain/draft.js";
import { validateDraft } from "../domain/validator.js";
import { buildInvoiceXml } from "../domain/xml-builder.js";

// ─── Schemas ────────────────────────────────────────────────────────────────────

const ItemSchema = z.object({
  name: z.string().describe("Nazwa pozycji"),
  quantity: z.number().positive().describe("Ilość"),
  unitPrice: z.number().min(0).describe("Cena jednostkowa netto"),
  vatRate: z.number().describe("Stawka VAT (23, 8, 5, 0, -1 dla zw)"),
  unit: z.string().optional().describe("Jednostka miary (domyślnie szt.)"),
});

const DraftCreateInput = z.object({
  sellerNip: z.string().describe("NIP sprzedawcy (10 cyfr)"),
  sellerName: z.string().describe("Nazwa sprzedawcy"),
  sellerAddress: z.string().optional().describe("Adres sprzedawcy"),
  buyerNip: z.string().describe("NIP nabywcy"),
  buyerName: z.string().describe("Nazwa nabywcy"),
  buyerAddress: z.string().optional().describe("Adres nabywcy"),
  invoiceNumber: z.string().describe("Numer faktury"),
  issueDate: z.string().describe("Data wystawienia (YYYY-MM-DD)"),
  sellDate: z.string().optional().describe("Data sprzedaży (YYYY-MM-DD)"),
  currency: z.string().optional().describe("Waluta (domyślnie PLN)"),
  items: z.array(ItemSchema).min(1).describe("Pozycje faktury"),
});

const DraftIdInput = z.object({
  id: z.string().describe("ID draftu (UUID)"),
});

const DraftListInput = z.object({
  status: z.enum(["draft", "validated", "locked", "sent", "error"]).optional()
    .describe("Filtruj po statusie"),
});

const DraftUpdateInput = z.object({
  id: z.string().describe("ID draftu (UUID)"),
  sellerNip: z.string().optional(),
  sellerName: z.string().optional(),
  sellerAddress: z.string().optional(),
  buyerNip: z.string().optional(),
  buyerName: z.string().optional(),
  buyerAddress: z.string().optional(),
  invoiceNumber: z.string().optional(),
  issueDate: z.string().optional(),
  sellDate: z.string().optional(),
  currency: z.string().optional(),
  items: z.array(ItemSchema).optional(),
});

// ─── Tools ──────────────────────────────────────────────────────────────────────

registerTool(
  {
    name: "ksef_draft_create",
    description:
      "Utwórz nowy draft faktury. Draft jest zapisywany lokalnie i może być edytowany " +
      "przed walidacją i wysłaniem do KSeF. Oblicza automatycznie kwoty netto/VAT/brutto.",
    inputSchema: {
      type: "object",
      properties: {
        sellerNip: { type: "string", description: "NIP sprzedawcy (10 cyfr)" },
        sellerName: { type: "string", description: "Nazwa sprzedawcy" },
        sellerAddress: { type: "string", description: "Adres sprzedawcy" },
        buyerNip: { type: "string", description: "NIP nabywcy" },
        buyerName: { type: "string", description: "Nazwa nabywcy" },
        buyerAddress: { type: "string", description: "Adres nabywcy" },
        invoiceNumber: { type: "string", description: "Numer faktury" },
        issueDate: { type: "string", description: "Data wystawienia (YYYY-MM-DD)" },
        sellDate: { type: "string", description: "Data sprzedaży (YYYY-MM-DD)" },
        currency: { type: "string", description: "Waluta (domyślnie PLN)" },
        items: {
          type: "array",
          description: "Pozycje faktury",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Nazwa pozycji" },
              quantity: { type: "number", description: "Ilość" },
              unitPrice: { type: "number", description: "Cena jednostkowa netto" },
              vatRate: { type: "number", description: "Stawka VAT (23, 8, 5, 0, -1 dla zw)" },
              unit: { type: "string", description: "Jednostka miary (domyślnie szt.)" },
            },
            required: ["name", "quantity", "unitPrice", "vatRate"],
          },
        },
      },
      required: ["sellerNip", "sellerName", "buyerNip", "buyerName", "invoiceNumber", "issueDate", "items"],
    },
  },
  async (args) => {
    const input = DraftCreateInput.parse(args);
    const draft = createDraft({
      ...input,
      currency: input.currency || "PLN",
    });
    return toolResult({
      status: "draft_utworzony",
      draft: sanitizeDraft(draft),
    });
  },
);

registerTool(
  {
    name: "ksef_draft_get",
    description: "Pobierz draft faktury po ID. Zwraca pełne dane draftu z obliczonymi kwotami.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID draftu (UUID)" },
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const input = DraftIdInput.parse(args);
    const draft = getDraft(input.id);
    if (!draft) return toolError(`Draft nie znaleziony: ${input.id}`);
    return toolResult(sanitizeDraft(draft));
  },
);

registerTool(
  {
    name: "ksef_draft_list",
    description: "Wyświetl listę wszystkich draftów faktur. Opcjonalnie filtruj po statusie.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "validated", "locked", "sent", "error"],
          description: "Filtruj po statusie draftu",
        },
      },
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const input = DraftListInput.parse(args);
    const drafts = listDrafts(input.status);
    return toolResult({
      count: drafts.length,
      drafts: drafts.map(sanitizeDraft),
    });
  },
);

registerTool(
  {
    name: "ksef_draft_update",
    description:
      "Zaktualizuj draft faktury (patch). Można zmienić dowolne pola: dane sprzedawcy/nabywcy, " +
      "numer, daty, pozycje. Przelicza kwoty automatycznie. Nie można edytować locked/sent.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID draftu (UUID)" },
        sellerNip: { type: "string", description: "NIP sprzedawcy" },
        sellerName: { type: "string", description: "Nazwa sprzedawcy" },
        sellerAddress: { type: "string", description: "Adres sprzedawcy" },
        buyerNip: { type: "string", description: "NIP nabywcy" },
        buyerName: { type: "string", description: "Nazwa nabywcy" },
        buyerAddress: { type: "string", description: "Adres nabywcy" },
        invoiceNumber: { type: "string", description: "Numer faktury" },
        issueDate: { type: "string", description: "Data wystawienia (YYYY-MM-DD)" },
        sellDate: { type: "string", description: "Data sprzedaży (YYYY-MM-DD)" },
        currency: { type: "string", description: "Waluta" },
        items: {
          type: "array",
          description: "Pozycje faktury (zastępuje istniejące)",
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
      required: ["id"],
    },
  },
  async (args) => {
    const input = DraftUpdateInput.parse(args);
    const { id, ...patch } = input;
    const draft = updateDraft(id, patch);
    return toolResult({
      status: "draft_zaktualizowany",
      draft: sanitizeDraft(draft),
    });
  },
);

registerTool(
  {
    name: "ksef_draft_delete",
    description: "Usuń draft faktury. Można usunąć tylko drafty w statusie draft lub error.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID draftu (UUID)" },
      },
      required: ["id"],
    },
    annotations: { destructiveHint: true },
  },
  async (args) => {
    const input = DraftIdInput.parse(args);
    deleteDraft(input.id);
    return toolResult({
      status: "draft_usuniety",
      id: input.id,
    });
  },
);

registerTool(
  {
    name: "ksef_draft_validate",
    description:
      "Zwaliduj draft faktury wg reguł FA(3). Sprawdza: NIP (suma kontrolna), " +
      "wymagane pola, poprawność dat, stawki VAT, spójność kwot. " +
      "Jeśli walidacja przejdzie, status zmienia się na 'validated'.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID draftu (UUID)" },
      },
      required: ["id"],
    },
  },
  async (args) => {
    const input = DraftIdInput.parse(args);
    const draft = getDraft(input.id);
    if (!draft) return toolError(`Draft nie znaleziony: ${input.id}`);

    const result = validateDraft(draft);

    if (result.valid) {
      // Update status to validated
      try {
        const updated = setDraftStatus(input.id, "validated");
        return toolResult({
          status: "walidacja_ok",
          valid: true,
          errors: [],
          draft: sanitizeDraft(updated),
        });
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    }

    return toolResult({
      status: "walidacja_blad",
      valid: false,
      errors: result.errors,
    });
  },
);

registerTool(
  {
    name: "ksef_draft_render_xml",
    description:
      "Wygeneruj podgląd XML faktury w formacie FA(3) z draftu. " +
      "Nie wysyła do KSeF — tylko renderuje XML. " +
      "Draft powinien być wcześniej zwalidowany (ksef_draft_validate).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ID draftu (UUID)" },
      },
      required: ["id"],
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const input = DraftIdInput.parse(args);
    const draft = getDraft(input.id);
    if (!draft) return toolError(`Draft nie znaleziony: ${input.id}`);

    // Validate before rendering
    const validation = validateDraft(draft);
    if (!validation.valid) {
      return toolError(
        `Draft ma błędy walidacji. Użyj ksef_draft_validate aby zobaczyć szczegóły.\n` +
        validation.errors.join("\n"),
      );
    }

    const xml = buildInvoiceXml(draft);
    log("info", `XML rendered for draft: ${input.id}`);

    return toolResult({
      id: input.id,
      invoiceNumber: draft.invoiceNumber,
      xml,
    });
  },
);

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Sanitize draft for tool response — mask NIPs.
 */
function sanitizeDraft(draft: DraftInvoice): Record<string, unknown> {
  return {
    ...draft,
    sellerNip: maskNip(draft.sellerNip),
    buyerNip: maskNip(draft.buyerNip),
  };
}

function maskNip(nip: string): string {
  if (!nip || nip.length < 5) return nip;
  return nip.slice(0, 3) + "***" + nip.slice(-2);
}
