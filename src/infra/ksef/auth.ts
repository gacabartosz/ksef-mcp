import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { config } from "../../utils/config.js";
import { log } from "../../utils/logger.js";
import { ksefRequest } from "./client.js";
import { encryptWithRsaOaep, getKsefPublicKey } from "./crypto.js";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ChallengeResponse {
  challenge: string;
  timestamp: string;
  timestampMs: number;
  clientIp: string;
}

export interface AuthInitResponse {
  referenceNumber: string;
  authenticationToken: {
    token: string;
    validUntil: string;
  };
}

export interface AuthTokensResponse {
  accessToken: {
    token: string;
    validUntil: string;
  };
  refreshToken: {
    token: string;
    validUntil: string;
  };
}

export interface AuthTokenRefreshResponse {
  accessToken: {
    token: string;
    validUntil: string;
  };
}

export interface SessionInfo {
  /** JWT access token for API calls */
  accessToken: string;
  accessTokenValidUntil: string;
  /** JWT refresh token for renewing access */
  refreshToken: string;
  refreshTokenValidUntil: string;
  /** Auth operation reference number */
  referenceNumber: string;
  nip: string;
  environment: string;
  startedAt: string;
  contextName?: string;

  // Legacy compatibility — maps to accessToken
  get token(): string;
}

interface SessionInfoData {
  accessToken: string;
  accessTokenValidUntil: string;
  refreshToken: string;
  refreshTokenValidUntil: string;
  referenceNumber: string;
  nip: string;
  environment: string;
  startedAt: string;
  contextName?: string;
}

function createSessionInfo(data: SessionInfoData): SessionInfo {
  return {
    ...data,
    get token() { return this.accessToken; },
  };
}

// ─── Session State ──────────────────────────────────────────────────────────────

let activeSession: SessionInfo | null = null;

export function getActiveSession(): SessionInfo | null {
  if (activeSession) return activeSession;
  try {
    if (existsSync(config.sessionFile)) {
      const raw = readFileSync(config.sessionFile, "utf-8");
      const data = JSON.parse(raw) as SessionInfoData;
      activeSession = createSessionInfo(data);
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
    const data: SessionInfoData = {
      accessToken: session.accessToken,
      accessTokenValidUntil: session.accessTokenValidUntil,
      refreshToken: session.refreshToken,
      refreshTokenValidUntil: session.refreshTokenValidUntil,
      referenceNumber: session.referenceNumber,
      nip: session.nip,
      environment: session.environment,
      startedAt: session.startedAt,
      contextName: session.contextName,
    };
    writeFileSync(config.sessionFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  } else {
    try {
      unlinkSync(config.sessionFile);
    } catch {
      // ignore
    }
  }
}

/** Clear session from memory and disk (no API call). */
export function clearSession(): void {
  activeSession = null;
  try { unlinkSync(config.sessionFile); } catch { /* ignore */ }
}

export function requireSession(): SessionInfo {
  const session = getActiveSession();
  if (!session) {
    throw new Error("Brak aktywnej sesji KSeF. Użyj ksef_auth_init aby się zalogować.");
  }
  return session;
}

/**
 * Refresh the access token using the refresh token.
 * POST /auth/token/refresh (Bearer: refreshToken)
 */
export async function refreshAccessToken(session: SessionInfo): Promise<SessionInfo> {
  log("info", "Odświeżanie access tokena KSeF");

  const response = await ksefRequest<AuthTokenRefreshResponse>(
    "POST",
    "/auth/token/refresh",
    undefined,
    { sessionToken: session.refreshToken },
  );

  const updated = createSessionInfo({
    accessToken: response.accessToken.token,
    accessTokenValidUntil: response.accessToken.validUntil,
    refreshToken: session.refreshToken,
    refreshTokenValidUntil: session.refreshTokenValidUntil,
    referenceNumber: session.referenceNumber,
    nip: session.nip,
    environment: session.environment,
    startedAt: session.startedAt,
    contextName: session.contextName,
  });

  saveSession(updated);
  log("info", "Access token odświeżony");
  return updated;
}

/**
 * Get a valid access token, refreshing if needed.
 */
export async function getValidAccessToken(): Promise<string> {
  const session = requireSession();

  // Check if access token is still valid (with 60s buffer)
  const expiresAt = new Date(session.accessTokenValidUntil).getTime();
  const now = Date.now();

  if (now < expiresAt - 60_000) {
    return session.accessToken;
  }

  // Try to refresh
  log("info", "Access token wygasł lub wkrótce wygaśnie, odświeżam...");
  const refreshed = await refreshAccessToken(session);
  return refreshed.accessToken;
}

// ─── Auth Flow (v2) ─────────────────────────────────────────────────────────────

/**
 * Step 1: Get authorization challenge.
 * POST /auth/challenge (no body, no auth required)
 */
export async function getChallenge(): Promise<ChallengeResponse> {
  log("info", "Pobieranie challenge autoryzacyjnego");

  const response = await ksefRequest<ChallengeResponse>(
    "POST",
    "/auth/challenge",
  );

  log("info", `Challenge otrzymany, timestamp: ${response.timestamp}`);
  return response;
}

/**
 * Step 2: Authenticate with KSeF token.
 * POST /auth/ksef-token
 *
 * Encrypts: RSA-OAEP(token|timestampMs)
 */
async function authenticateWithToken(
  nip: string,
  ksefToken: string,
  challenge: ChallengeResponse,
): Promise<AuthInitResponse> {
  log("info", "Uwierzytelnianie tokenem KSeF");

  // Format: token|timestampMs — encrypted with KSeF public key (RSA-OAEP SHA-256)
  const tokenPayload = Buffer.from(`${ksefToken}|${challenge.timestampMs}`);

  let encryptedToken: string;
  try {
    const pubKey = await getKsefPublicKey("KsefTokenEncryption");
    const encrypted = encryptWithRsaOaep(tokenPayload, pubKey);
    encryptedToken = encrypted.toString("base64");
  } catch {
    log("warn", "Nie udało się zaszyfrować tokena — próba bez szyfrowania (TE)");
    encryptedToken = tokenPayload.toString("base64");
  }

  const body = {
    challenge: challenge.challenge,
    contextIdentifier: {
      type: "Nip",
      value: nip,
    },
    encryptedToken,
  };

  return ksefRequest<AuthInitResponse>(
    "POST",
    "/auth/ksef-token",
    body,
  );
}

/**
 * Step 3: Redeem authentication token for access + refresh tokens.
 * POST /auth/token/redeem (Bearer: authenticationToken)
 */
async function redeemAuthToken(authToken: string): Promise<AuthTokensResponse> {
  log("info", "Pobieranie tokenów dostępowych (redeem)");

  return ksefRequest<AuthTokensResponse>(
    "POST",
    "/auth/token/redeem",
    undefined,
    { sessionToken: authToken },
  );
}

/**
 * Full auth flow: challenge → ksef-token → token/redeem.
 * Returns a SessionInfo with JWT access + refresh tokens.
 */
export async function initTokenSession(nip: string, ksefToken: string): Promise<SessionInfo> {
  // Step 1: Get challenge
  const challenge = await getChallenge();

  // Step 2: Authenticate with encrypted KSeF token
  const authResponse = await authenticateWithToken(nip, ksefToken, challenge);
  log("info", `Auth init OK, ref: ${authResponse.referenceNumber}`);

  // Step 3: Redeem auth token for access + refresh JWTs
  const tokens = await redeemAuthToken(authResponse.authenticationToken.token);

  const session = createSessionInfo({
    accessToken: tokens.accessToken.token,
    accessTokenValidUntil: tokens.accessToken.validUntil,
    refreshToken: tokens.refreshToken.token,
    refreshTokenValidUntil: tokens.refreshToken.validUntil,
    referenceNumber: authResponse.referenceNumber,
    nip,
    environment: config.env,
    startedAt: new Date().toISOString(),
  });

  saveSession(session);
  log("info", `Sesja KSeF aktywna, ref: ${authResponse.referenceNumber}`);

  return session;
}

/**
 * Get auth operation status.
 * GET /auth/{referenceNumber}
 */
export async function getAuthStatus(session: SessionInfo): Promise<Record<string, unknown>> {
  return ksefRequest<Record<string, unknown>>(
    "GET",
    `/auth/${session.referenceNumber}`,
    undefined,
    { sessionToken: session.accessToken },
  );
}

/**
 * Terminate current auth session (invalidate refresh token).
 * DELETE /auth/sessions/current
 */
export async function terminateSession(session: SessionInfo): Promise<void> {
  log("info", `Zamykanie sesji KSeF, ref: ${session.referenceNumber}`);

  await ksefRequest(
    "DELETE",
    "/auth/sessions/current",
    undefined,
    { sessionToken: session.accessToken },
  );

  saveSession(null);
  log("info", "Sesja KSeF zakończona");
}

// ─── Legacy compatibility ────────────────────────────────────────────────────────

/** @deprecated Use getAuthStatus instead */
export async function getSessionStatus(session: SessionInfo): Promise<Record<string, unknown>> {
  return getAuthStatus(session);
}
