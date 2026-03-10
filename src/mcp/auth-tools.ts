import { z } from "zod";
import { registerTool } from "./registry.js";
import { toolResult, toolError } from "../utils/errors.js";
import { config } from "../utils/config.js";
import {
  getActiveSession,
  initTokenSession,
  getAuthStatus,
  terminateSession,
  requireSession,
  refreshAccessToken,
} from "../infra/ksef/auth.js";

// ─── Schemas ────────────────────────────────────────────────────────────────────

const EnvSetInput = z.object({
  environment: z.enum(["test", "demo", "prod"]),
  nip: z.string().length(10).optional(),
  token: z.string().optional(),
});

const AuthInitInput = z.object({
  nip: z.string().length(10).optional(),
  token: z.string().optional(),
  environment: z.enum(["test", "demo", "prod"]).optional(),
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
      apiVersion: "v2",
      nip: config.maskedNip,
      approvalMode: config.approvalMode,
      session: session
        ? {
            active: true,
            referenceNumber: session.referenceNumber,
            startedAt: session.startedAt,
            contextName: session.contextName || null,
            accessTokenValidUntil: session.accessTokenValidUntil,
            refreshTokenValidUntil: session.refreshTokenValidUntil,
          }
        : { active: false },
    });
  },
);

registerTool(
  {
    name: "ksef_env_set",
    description:
      "Zmień środowisko KSeF (test/demo/prod), NIP lub token w runtime. " +
      "Pozwala przełączać się między produkcją a testami bez restartu.",
    inputSchema: {
      type: "object",
      properties: {
        environment: {
          type: "string",
          enum: ["test", "demo", "prod"],
          description: "Środowisko KSeF: test, demo lub prod",
        },
        nip: {
          type: "string",
          description: "NIP podmiotu (10 cyfr). Opcjonalnie — zmienia bieżący NIP.",
        },
        token: {
          type: "string",
          description: "Token KSeF. Opcjonalnie — zmienia bieżący token.",
        },
      },
      required: ["environment"],
    },
  },
  async (args) => {
    const input = EnvSetInput.parse(args);

    const oldEnv = config.env;
    config.setEnvironment(input.environment);

    if (input.nip) config.setNip(input.nip);
    if (input.token) config.setToken(input.token);

    return toolResult({
      status: "srodowisko_zmienione",
      previousEnvironment: oldEnv,
      environment: config.env,
      baseUrl: config.baseUrl,
      nip: config.maskedNip,
      hint: oldEnv !== input.environment
        ? "Środowisko zmienione. Jeśli była aktywna sesja, musisz się ponownie zalogować (ksef_auth_init)."
        : "Środowisko bez zmian.",
    });
  },
);

registerTool(
  {
    name: "ksef_auth_init",
    description:
      "Rozpocznij sesję KSeF używając tokena autoryzacyjnego (API v2). " +
      "Flow: challenge → ksef-token → token/redeem → JWT access + refresh. " +
      "NIP, token i środowisko można podać jako argumenty lub ustawić w env.",
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
        environment: {
          type: "string",
          enum: ["test", "demo", "prod"],
          description: "Środowisko KSeF (test/demo/prod). Domyślnie z env KSEF_ENV.",
        },
      },
    },
    annotations: { readOnlyHint: false },
  },
  async (args) => {
    const input = AuthInitInput.parse(args);

    // Switch environment if specified
    if (input.environment && input.environment !== config.env) {
      config.setEnvironment(input.environment);
    }

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
      accessTokenValidUntil: session.accessTokenValidUntil,
      refreshTokenValidUntil: session.refreshTokenValidUntil,
    });
  },
);

registerTool(
  {
    name: "ksef_auth_status",
    description: "Sprawdź status aktywnej sesji KSeF — czy jest aktywna, tokeny, ważność.",
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
      const authStatus = await getAuthStatus(session);
      return toolResult({
        status: "aktywna",
        referenceNumber: session.referenceNumber,
        environment: session.environment,
        nip: config.maskedNip,
        contextName: session.contextName || null,
        startedAt: session.startedAt,
        accessTokenValidUntil: session.accessTokenValidUntil,
        refreshTokenValidUntil: session.refreshTokenValidUntil,
        authDetails: authStatus,
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
    description: "Zakończ aktywną sesję KSeF (unieważnij refresh token). Operacja nieodwracalna.",
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
