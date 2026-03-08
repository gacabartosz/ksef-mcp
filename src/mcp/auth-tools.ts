import { z } from "zod";
import { registerTool } from "./registry.js";
import { toolResult, toolError } from "../utils/errors.js";
import { config } from "../utils/config.js";
import { getActiveSession, initTokenSession, getSessionStatus, terminateSession, requireSession } from "../infra/ksef/auth.js";

// ─── Schemas ────────────────────────────────────────────────────────────────────

const AuthInitInput = z.object({
  nip: z.string().length(10).optional(),
  token: z.string().optional(),
});

// ─── Tools ──────────────────────────────────────────────────────────────────────

registerTool(
  {
    name: "ksef_env_info",
    description: "Pokaż aktualne środowisko KSeF, zamaskowany NIP i status sesji. Nie wymaga logowania.",
    inputSchema: { type: "object", properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },
  async () => {
    const session = getActiveSession();
    return toolResult({
      environment: config.env,
      baseUrl: config.baseUrl,
      nip: config.maskedNip,
      approvalMode: config.approvalMode,
      session: session
        ? {
            active: true,
            referenceNumber: session.referenceNumber,
            startedAt: session.startedAt,
            contextName: session.contextName || null,
          }
        : { active: false },
    });
  },
);

registerTool(
  {
    name: "ksef_auth_init",
    description:
      "Rozpocznij sesję KSeF używając tokena autoryzacyjnego. " +
      "NIP i token można podać jako argumenty lub ustawić w zmiennych środowiskowych KSEF_NIP i KSEF_TOKEN. " +
      "Wymaga aktywnego połączenia z API KSeF.",
    inputSchema: {
      type: "object",
      properties: {
        nip: {
          type: "string",
          description: "NIP podmiotu (10 cyfr). Domyślnie z env KSEF_NIP.",
        },
        token: {
          type: "string",
          description: "Token autoryzacyjny KSeF. Domyślnie z env KSEF_TOKEN.",
        },
      },
    },
    annotations: { readOnlyHint: false },
  },
  async (args) => {
    const input = AuthInitInput.parse(args);
    const nip = input.nip || config.nip;
    const token = input.token || config.token;

    if (!nip) return toolError("Brak NIP. Podaj jako argument lub ustaw KSEF_NIP.");
    if (!token) return toolError("Brak tokena KSeF. Podaj jako argument lub ustaw KSEF_TOKEN.");
    if (nip.length !== 10 || !/^\d{10}$/.test(nip)) return toolError("NIP musi mieć 10 cyfr.");

    const existing = getActiveSession();
    if (existing) {
      return toolError(
        `Sesja KSeF już aktywna (ref: ${existing.referenceNumber}). ` +
        "Użyj ksef_auth_terminate aby ją zakończyć.",
      );
    }

    const session = await initTokenSession(nip, token);

    return toolResult({
      status: "zalogowano",
      referenceNumber: session.referenceNumber,
      environment: session.environment,
      nip: config.maskedNip,
      contextName: session.contextName || null,
      startedAt: session.startedAt,
    });
  },
);

registerTool(
  {
    name: "ksef_auth_status",
    description: "Sprawdź status aktywnej sesji KSeF — czy jest aktywna, ile faktur przetworzono.",
    inputSchema: { type: "object", properties: {}, required: [] },
    annotations: { readOnlyHint: true },
  },
  async () => {
    const session = getActiveSession();
    if (!session) {
      return toolResult({
        status: "niezalogowany",
        hint: "Użyj ksef_auth_init aby rozpocząć sesję.",
      });
    }

    try {
      const status = await getSessionStatus(session);
      return toolResult({
        status: "aktywna",
        referenceNumber: session.referenceNumber,
        environment: session.environment,
        nip: config.maskedNip,
        contextName: session.contextName || null,
        startedAt: session.startedAt,
        processingCode: status.processingCode,
        processingDescription: status.processingDescription,
        numberOfInvoices: status.numberOfInvoices ?? 0,
      });
    } catch {
      return toolResult({
        status: "nieaktywna_lub_wygasla",
        referenceNumber: session.referenceNumber,
        hint: "Sesja mogła wygasnąć. Użyj ksef_auth_init aby rozpocząć nową.",
      });
    }
  },
);

registerTool(
  {
    name: "ksef_auth_terminate",
    description: "Zakończ aktywną sesję KSeF. Operacja nieodwracalna.",
    inputSchema: { type: "object", properties: {}, required: [] },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  async () => {
    const session = requireSession();

    try {
      await terminateSession(session);
      return toolResult({
        status: "sesja_zakonczona",
        referenceNumber: session.referenceNumber,
      });
    } catch (err) {
      // Even if API fails, clear local session
      const { unlinkSync } = await import("node:fs");
      try { unlinkSync(config.sessionFile); } catch { /* ignore */ }
      return toolResult({
        status: "sesja_wyczyszczona_lokalnie",
        referenceNumber: session.referenceNumber,
        warning: err instanceof Error ? err.message : "Błąd API przy zamykaniu sesji",
      });
    }
  },
);
