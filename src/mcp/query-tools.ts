import { z } from "zod";
import { registerTool } from "./registry.js";
import { toolResult, toolError } from "../utils/errors.js";
import { requireSession } from "../infra/ksef/auth.js";
import { ksefRequest } from "../infra/ksef/client.js";

// ─── Schemas ────────────────────────────────────────────────────────────────────

const InvoicesQueryInput = z.object({
  dateFrom: z.string().describe("Data od (YYYY-MM-DD)"),
  dateTo: z.string().optional().describe("Data do (YYYY-MM-DD) — opcjonalna"),
  dateType: z.enum(["Issue", "Invoicing", "PermanentStorage"]).optional()
    .describe("Typ daty: Issue=wystawienia, Invoicing=przyjęcia, PermanentStorage=trwałego zapisu"),
  subjectType: z.enum(["Subject1", "Subject2", "Subject3", "SubjectAuthorized"]).optional()
    .describe("Typ podmiotu: Subject1=sprzedawca, Subject2=nabywca, Subject3=inny, SubjectAuthorized=upoważniony"),
  pageSize: z.number().int().min(10).max(100).optional(),
  continuationToken: z.string().optional().describe("Token kontynuacji z poprzedniego zapytania"),
});

const InvoiceKsefNumberInput = z.object({
  ksefNumber: z.string().describe("Numer KSeF faktury (35-36 znaków)"),
});

const SessionInvoiceInput = z.object({
  sessionReferenceNumber: z.string().describe("Numer referencyjny sesji"),
  invoiceReferenceNumber: z.string().describe("Numer referencyjny faktury w sesji"),
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
        dateTo: { type: "string", description: "Data do (YYYY-MM-DD) — opcjonalna" },
        dateType: {
          type: "string",
          enum: ["Issue", "Invoicing", "PermanentStorage"],
          description: "Typ daty: Issue=wystawienia, Invoicing=przyjęcia w KSeF, PermanentStorage=trwałego zapisu",
        },
        subjectType: {
          type: "string",
          enum: ["Subject1", "Subject2", "Subject3", "SubjectAuthorized"],
          description: "Typ podmiotu: Subject1=sprzedawca, Subject2=nabywca, Subject3=inny, SubjectAuthorized=upoważniony",
        },
        pageSize: { type: "number", description: "Rozmiar strony (10-100, domyślnie 10)" },
        continuationToken: { type: "string", description: "Token kontynuacji z poprzedniego zapytania" },
      },
      required: ["dateFrom"],
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const input = InvoicesQueryInput.parse(args);
    const session = requireSession();

    const body: Record<string, unknown> = {
      subjectType: input.subjectType || "Subject1",
      dateRange: {
        dateType: input.dateType || "Invoicing",
        from: `${input.dateFrom}T00:00:00Z`,
        ...(input.dateTo ? { to: `${input.dateTo}T23:59:59Z` } : {}),
      },
    };

    const headers: Record<string, string> = {};
    if (input.pageSize) {
      headers["pageSize"] = String(input.pageSize);
    }
    if (input.continuationToken) {
      headers["x-continuation-token"] = input.continuationToken;
    }

    const queryParts: string[] = [];
    if (input.pageSize) queryParts.push(`pageSize=${input.pageSize}`);
    const query = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";

    const response = await ksefRequest<{
      invoices: Array<{
        ksefNumber?: string;
        invoiceNumber?: string;
        invoicingDate?: string;
        subjectByNip?: string;
        subjectToNip?: string;
        net?: string;
        vat?: string;
        gross?: string;
        schemaVersion?: string;
        referenceNumber?: string;
      }>;
      hasMore: boolean;
      isTruncated: boolean;
      continuationToken?: string;
    }>(
      "POST",
      `/invoices/query/metadata${query}`,
      body,
      {
        sessionToken: session.accessToken,
        ...(input.continuationToken ? {} : {}),
      },
    );

    return toolResult({
      invoices: response.invoices || [],
      hasMore: response.hasMore,
      isTruncated: response.isTruncated,
      continuationToken: response.continuationToken,
    });
  },
);

registerTool(
  {
    name: "ksef_invoice_get",
    description:
      "Pobierz fakturę XML po numerze KSeF. Wymaga aktywnej sesji. " +
      "Zwraca pełny XML faktury.",
    inputSchema: {
      type: "object",
      properties: {
        ksefNumber: { type: "string", description: "Numer KSeF faktury (35-36 znaków)" },
      },
      required: ["ksefNumber"],
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const input = InvoiceKsefNumberInput.parse(args);
    const session = requireSession();

    // GET /invoices/ksef/{ksefNumber} returns XML
    const { config: cfg } = await import("../utils/config.js");
    const url = `${cfg.baseUrl}/invoices/ksef/${input.ksefNumber}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          Accept: "application/xml",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        return toolError(`Błąd pobierania faktury: HTTP ${response.status}`);
      }

      const xml = await response.text();
      return toolResult({ ksefNumber: input.ksefNumber, xml });
    } finally {
      clearTimeout(timer);
    }
  },
);

registerTool(
  {
    name: "ksef_invoice_status",
    description:
      "Sprawdź status przetwarzania faktury w sesji KSeF. Wymaga aktywnej sesji. " +
      "Potrzebne: numer referencyjny sesji i numer referencyjny faktury.",
    inputSchema: {
      type: "object",
      properties: {
        sessionReferenceNumber: { type: "string", description: "Numer referencyjny sesji" },
        invoiceReferenceNumber: { type: "string", description: "Numer referencyjny faktury" },
      },
      required: ["sessionReferenceNumber", "invoiceReferenceNumber"],
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const input = SessionInvoiceInput.parse(args);
    const session = requireSession();

    const response = await ksefRequest<Record<string, unknown>>(
      "GET",
      `/sessions/${input.sessionReferenceNumber}/invoices/${input.invoiceReferenceNumber}`,
      undefined,
      { sessionToken: session.accessToken },
    );

    return toolResult(response);
  },
);

registerTool(
  {
    name: "ksef_invoice_xml",
    description:
      "Pobierz XML faktury z KSeF po numerze KSeF (format FA(3)). " +
      "Alias dla ksef_invoice_get. Wymaga aktywnej sesji.",
    inputSchema: {
      type: "object",
      properties: {
        ksefNumber: { type: "string", description: "Numer KSeF faktury" },
      },
      required: ["ksefNumber"],
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const input = InvoiceKsefNumberInput.parse(args);
    const session = requireSession();

    const { config: cfg } = await import("../utils/config.js");
    const url = `${cfg.baseUrl}/invoices/ksef/${input.ksefNumber}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          Accept: "application/xml",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        return toolError(`Błąd pobierania XML: HTTP ${response.status}`);
      }

      const xml = await response.text();
      return toolResult({ ksefNumber: input.ksefNumber, xml });
    } finally {
      clearTimeout(timer);
    }
  },
);

registerTool(
  {
    name: "ksef_upo_download",
    description:
      "Pobierz UPO (Urzędowe Poświadczenie Odbioru) dla faktury z sesji KSeF. " +
      "UPO potwierdza przyjęcie faktury przez system. Wymaga aktywnej sesji.",
    inputSchema: {
      type: "object",
      properties: {
        sessionReferenceNumber: {
          type: "string",
          description: "Numer referencyjny sesji wysyłkowej",
        },
        invoiceReferenceNumber: {
          type: "string",
          description: "Numer referencyjny faktury w sesji (opcjonalny — jeśli brak, pobiera UPO sesji)",
        },
      },
      required: ["sessionReferenceNumber"],
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const session = requireSession();
    const sessionRef = args.sessionReferenceNumber as string;
    const invoiceRef = args.invoiceReferenceNumber as string | undefined;

    if (invoiceRef) {
      // Get UPO for specific invoice
      try {
        const { getInvoiceUpo } = await import("../infra/ksef/session.js");
        const upoXml = await getInvoiceUpo(session.accessToken, sessionRef, invoiceRef);
        return toolResult({
          sessionReferenceNumber: sessionRef,
          invoiceReferenceNumber: invoiceRef,
          upo: upoXml,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(`Błąd pobierania UPO: ${msg}`);
      }
    } else {
      // Get session status which includes UPO download URLs
      const { getSessionStatus } = await import("../infra/ksef/session.js");
      const status = await getSessionStatus(session.accessToken, sessionRef);

      if (status.upo && status.upo.pages.length > 0) {
        return toolResult({
          sessionReferenceNumber: sessionRef,
          status: status.status,
          upoPages: status.upo.pages,
        });
      }

      return toolResult({
        sessionReferenceNumber: sessionRef,
        status: status.status,
        message: "UPO jeszcze niedostępne",
      });
    }
  },
);
