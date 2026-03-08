import { z } from "zod";
import { registerTool } from "./registry.js";
import { toolResult, toolError } from "../utils/errors.js";
import { requireSession } from "../infra/ksef/auth.js";
import { ksefRequest } from "../infra/ksef/client.js";

// ─── Schemas ────────────────────────────────────────────────────────────────────

const InvoicesQueryInput = z.object({
  dateFrom: z.string().describe("Data od (YYYY-MM-DD)"),
  dateTo: z.string().describe("Data do (YYYY-MM-DD)"),
  subjectType: z.enum(["subject1", "subject2", "subject3"]).optional()
    .describe("Typ podmiotu: subject1=sprzedawca, subject2=nabywca, subject3=inny"),
  pageSize: z.number().int().min(10).max(100).optional(),
  pageOffset: z.number().int().min(0).optional(),
});

const InvoiceRefInput = z.object({
  ksefReferenceNumber: z.string().describe("Numer referencyjny KSeF faktury"),
});

// ─── Tools ──────────────────────────────────────────────────────────────────────

registerTool(
  {
    name: "ksef_invoices_query",
    description:
      "Wyszukaj faktury w KSeF po zakresie dat. " +
      "Wymaga aktywnej sesji (ksef_auth_init). " +
      "Zwraca metadane faktur: numer KSeF, NIP, kwota, data.",
    inputSchema: {
      type: "object",
      properties: {
        dateFrom: { type: "string", description: "Data od (YYYY-MM-DD)" },
        dateTo: { type: "string", description: "Data do (YYYY-MM-DD)" },
        subjectType: {
          type: "string",
          enum: ["subject1", "subject2", "subject3"],
          description: "Typ podmiotu: subject1=sprzedawca, subject2=nabywca, subject3=inny",
        },
        pageSize: { type: "number", description: "Rozmiar strony (10-100, domyślnie 10)" },
        pageOffset: { type: "number", description: "Numer strony (od 0)" },
      },
      required: ["dateFrom", "dateTo"],
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const input = InvoicesQueryInput.parse(args);
    const session = requireSession();

    const body = {
      queryCriteria: {
        subjectType: input.subjectType || "subject1",
        type: "incremental",
        acquisitionTimestampThresholdFrom: `${input.dateFrom}T00:00:00`,
        acquisitionTimestampThresholdTo: `${input.dateTo}T23:59:59`,
      },
    };

    const queryParams = new URLSearchParams();
    queryParams.set("PageSize", String(input.pageSize || 10));
    queryParams.set("PageOffset", String(input.pageOffset || 0));

    const response = await ksefRequest<{
      invoiceHeaderList: Array<{
        invoiceReferenceNumber: string;
        ksefReferenceNumber: string;
        invoiceHash?: string;
        invoicingDate?: string;
        subjectTo?: { issuedToIdentifier?: { identifier: string } };
        subjectBy?: { issuedByIdentifier?: { identifier: string } };
        net?: string;
        vat?: string;
        gross?: string;
        schemaVersion?: string;
      }>;
      numberOfElements: number;
      pageSize: number;
      pageOffset: number;
    }>(
      "POST",
      `/online/Query/Invoice/Sync?${queryParams.toString()}`,
      body,
      { sessionToken: session.token },
    );

    const invoices = (response.invoiceHeaderList || []).map((inv) => ({
      ksefReferenceNumber: inv.ksefReferenceNumber,
      invoicingDate: inv.invoicingDate,
      sellerNip: inv.subjectBy?.issuedByIdentifier?.identifier,
      buyerNip: inv.subjectTo?.issuedToIdentifier?.identifier,
      net: inv.net,
      vat: inv.vat,
      gross: inv.gross,
      schemaVersion: inv.schemaVersion,
    }));

    return toolResult({
      count: response.numberOfElements,
      pageSize: response.pageSize,
      pageOffset: response.pageOffset,
      invoices,
    });
  },
);

registerTool(
  {
    name: "ksef_invoice_get",
    description: "Pobierz metadane faktury po numerze referencyjnym KSeF. Wymaga aktywnej sesji.",
    inputSchema: {
      type: "object",
      properties: {
        ksefReferenceNumber: { type: "string", description: "Numer referencyjny KSeF faktury" },
      },
      required: ["ksefReferenceNumber"],
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const input = InvoiceRefInput.parse(args);
    const session = requireSession();

    const response = await ksefRequest<Record<string, unknown>>(
      "GET",
      `/online/Invoice/Get/${input.ksefReferenceNumber}`,
      undefined,
      { sessionToken: session.token },
    );

    return toolResult(response);
  },
);

registerTool(
  {
    name: "ksef_invoice_status",
    description: "Sprawdź status przetwarzania faktury w KSeF. Wymaga aktywnej sesji.",
    inputSchema: {
      type: "object",
      properties: {
        ksefReferenceNumber: { type: "string", description: "Numer referencyjny KSeF faktury" },
      },
      required: ["ksefReferenceNumber"],
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const input = InvoiceRefInput.parse(args);
    const session = requireSession();

    const response = await ksefRequest<Record<string, unknown>>(
      "GET",
      `/online/Invoice/Status/${input.ksefReferenceNumber}`,
      undefined,
      { sessionToken: session.token },
    );

    return toolResult(response);
  },
);

registerTool(
  {
    name: "ksef_invoice_xml",
    description:
      "Pobierz XML faktury z KSeF (format FA(3)). " +
      "Zwraca pełną treść XML dokumentu. Wymaga aktywnej sesji.",
    inputSchema: {
      type: "object",
      properties: {
        ksefReferenceNumber: { type: "string", description: "Numer referencyjny KSeF faktury" },
      },
      required: ["ksefReferenceNumber"],
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const input = InvoiceRefInput.parse(args);
    const session = requireSession();

    // Invoice XML endpoint zwraca XML, nie JSON
    const { config: cfg } = await import("../utils/config.js");
    const url = `${cfg.baseUrl}/online/Invoice/Get/${input.ksefReferenceNumber}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(url, {
        headers: {
          SessionToken: session.token,
          Accept: "application/xml",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        return toolError(`Błąd pobierania XML: HTTP ${response.status}`);
      }

      const xml = await response.text();
      return toolResult({ ksefReferenceNumber: input.ksefReferenceNumber, xml });
    } finally {
      clearTimeout(timer);
    }
  },
);

registerTool(
  {
    name: "ksef_upo_download",
    description:
      "Pobierz UPO (Urzędowe Poświadczenie Odbioru) dla sesji KSeF. " +
      "UPO potwierdza przyjęcie faktury przez system. Wymaga aktywnej sesji.",
    inputSchema: {
      type: "object",
      properties: {
        referenceNumber: {
          type: "string",
          description: "Numer referencyjny sesji KSeF (nie faktury). Domyślnie bieżąca sesja.",
        },
      },
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const session = requireSession();
    const refNr = (args.referenceNumber as string) || session.referenceNumber;

    const response = await ksefRequest<{
      processingCode: number;
      processingDescription: string;
      upo?: string;
    }>(
      "GET",
      `/online/Session/Status/${refNr}`,
      undefined,
      { sessionToken: session.token },
    );

    if (response.upo) {
      return toolResult({
        referenceNumber: refNr,
        upo: response.upo,
        processingCode: response.processingCode,
      });
    }

    return toolResult({
      referenceNumber: refNr,
      status: "UPO jeszcze niedostępne",
      processingCode: response.processingCode,
      processingDescription: response.processingDescription,
    });
  },
);
