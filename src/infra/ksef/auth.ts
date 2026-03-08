import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { config } from "../../utils/config.js";
import { log } from "../../utils/logger.js";
import { ksefRequest } from "./client.js";
import { encryptWithRsaOaep } from "./crypto.js";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ChallengeResponse {
  timestamp: string;
  challenge: string;
}

export interface InitSessionResponse {
  sessionToken: {
    token: string;
    context: {
      contextIdentifier: {
        type: string;
        identifier: string;
      };
      contextName?: {
        type: string;
        tradeName?: string;
        fullName?: string;
      };
      credentialsRoleList?: Array<{
        type: number;
        roleDescription: string;
        roleType: string;
      }>;
    };
  };
  referenceNumber: string;
  processingCode: number;
  processingDescription: string;
}

export interface SessionStatus {
  processingCode: number;
  processingDescription: string;
  referenceNumber: string;
  numberOfInvoices?: number;
}

export interface SessionInfo {
  token: string;
  referenceNumber: string;
  nip: string;
  environment: string;
  startedAt: string;
  contextName?: string;
}

// ─── Session State ──────────────────────────────────────────────────────────────

let activeSession: SessionInfo | null = null;

export function getActiveSession(): SessionInfo | null {
  if (activeSession) return activeSession;
  // Try loading from disk
  try {
    if (existsSync(config.sessionFile)) {
      const data = readFileSync(config.sessionFile, "utf-8");
      activeSession = JSON.parse(data) as SessionInfo;
      return activeSession;
    }
  } catch {
    // ignore
  }
  return null;
}

function saveSession(session: SessionInfo | null): void {
  activeSession = session;
  if (session) {
    writeFileSync(config.sessionFile, JSON.stringify(session, null, 2), { mode: 0o600 });
  } else {
    try {
      unlinkSync(config.sessionFile);
    } catch {
      // ignore
    }
  }
}

export function requireSession(): SessionInfo {
  const session = getActiveSession();
  if (!session) {
    throw new Error("Brak aktywnej sesji KSeF. Użyj ksef_auth_init aby się zalogować.");
  }
  return session;
}

// ─── Auth Flow ──────────────────────────────────────────────────────────────────

/**
 * Krok 1: Pobierz challenge autoryzacyjny.
 * POST /online/Session/AuthorisationChallenge
 */
export async function getChallenge(nip: string): Promise<ChallengeResponse> {
  log("info", "Pobieranie challenge autoryzacyjnego");

  const response = await ksefRequest<ChallengeResponse>(
    "POST",
    "/online/Session/AuthorisationChallenge",
    {
      contextIdentifier: {
        type: "onip",
        identifier: nip,
      },
    },
  );

  log("info", `Challenge otrzymany, timestamp: ${response.timestamp}`);
  return response;
}

/**
 * Krok 2+3: Inicjalizuj sesję tokenem KSeF.
 * POST /online/Session/InitToken
 *
 * Flow:
 * 1. Pobierz challenge
 * 2. Zaszyfruj token: RSA-OAEP(base64(KSEF_TOKEN | timestamp))
 * 3. Wyślij InitToken z zaszyfrowanym tokenem
 */
export async function initTokenSession(nip: string, ksefToken: string): Promise<SessionInfo> {
  // Krok 1: Challenge
  const challenge = await getChallenge(nip);

  // Krok 2: Przygotuj i zaszyfruj token
  // Format: base64(token + "|" + timestamp) — zaszyfrowany kluczem publicznym KSeF
  const tokenPayload = Buffer.from(`${ksefToken}|${challenge.timestamp}`);

  // Na środowisku testowym KSeF akceptuje nieszyfrowane tokeny
  // lub można użyć klucza publicznego
  let encryptedToken: string;

  try {
    // Próbuj zaszyfrować kluczem publicznym KSeF
    const { getKsefPublicKey } = await import("./crypto.js");
    const pubKey = await getKsefPublicKey();
    const encrypted = encryptWithRsaOaep(tokenPayload, pubKey);
    encryptedToken = encrypted.toString("base64");
  } catch {
    // Fallback: wyślij token base64 bez szyfrowania (środowisko testowe)
    log("warn", "Nie udało się zaszyfrować tokena — próba bez szyfrowania (TE)");
    encryptedToken = tokenPayload.toString("base64");
  }

  // Krok 3: InitToken
  log("info", "Inicjalizacja sesji KSeF tokenem");

  const body = {
    context: {
      contextIdentifier: {
        type: "onip",
        identifier: nip,
      },
      token: encryptedToken,
    },
    init: {
      challenge: challenge.challenge,
      timestamp: challenge.timestamp,
      identifier: {
        type: "onip",
        identifier: nip,
      },
    },
  };

  const response = await ksefRequest<InitSessionResponse>(
    "POST",
    "/online/Session/InitToken",
    body,
  );

  const session: SessionInfo = {
    token: response.sessionToken.token,
    referenceNumber: response.referenceNumber,
    nip,
    environment: config.env,
    startedAt: new Date().toISOString(),
    contextName: response.sessionToken.context.contextName?.tradeName
      || response.sessionToken.context.contextName?.fullName,
  };

  saveSession(session);
  log("info", `Sesja KSeF aktywna, ref: ${response.referenceNumber}`);

  return session;
}

/**
 * Pobierz status sesji.
 * GET /online/Session/Status/{referenceNumber}
 */
export async function getSessionStatus(session: SessionInfo): Promise<SessionStatus> {
  return ksefRequest<SessionStatus>(
    "GET",
    `/online/Session/Status/${session.referenceNumber}`,
    undefined,
    { sessionToken: session.token },
  );
}

/**
 * Zakończ sesję.
 * GET /online/Session/Terminate
 */
export async function terminateSession(session: SessionInfo): Promise<void> {
  log("info", `Zamykanie sesji KSeF, ref: ${session.referenceNumber}`);

  await ksefRequest(
    "GET",
    "/online/Session/Terminate",
    undefined,
    { sessionToken: session.token },
  );

  saveSession(null);
  log("info", "Sesja KSeF zakończona");
}
