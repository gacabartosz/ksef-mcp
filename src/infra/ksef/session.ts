import { ksefRequest } from "./client.js";
import {
  encryptAes256Cbc,
  encryptWithRsaOaep,
  generateAesKey,
  getKsefPublicKey,
  sha256base64,
} from "./crypto.js";
import { log } from "../../utils/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface OnlineSessionInfo {
  referenceNumber: string;
  validUntil: string;
  /** AES key used for encrypting invoices in this session */
  aesKey: Buffer;
  /** IV used when opening the session */
  iv: Buffer;
}

export interface SendInvoiceResult {
  referenceNumber: string;
}

export interface SessionStatusResponse {
  status: {
    code: number;
    description: string;
    details?: string[];
  };
  dateCreated: string;
  dateUpdated: string;
  invoiceCount?: number;
  successfulInvoiceCount?: number;
  failedInvoiceCount?: number;
  upo?: {
    pages: Array<{
      referenceNumber: string;
      downloadUrl: string;
      downloadUrlExpirationDate: string;
    }>;
  };
}

export interface SessionInvoiceStatusResponse {
  ordinalNumber: number;
  invoiceNumber?: string;
  ksefNumber?: string;
  referenceNumber: string;
  status: {
    code: number;
    description: string;
    details?: string[];
  };
  invoiceHash: string;
  invoicingDate: string;
}

// ─── Online Session Management ──────────────────────────────────────────────────

let activeOnlineSession: OnlineSessionInfo | null = null;

export function getActiveOnlineSession(): OnlineSessionInfo | null {
  return activeOnlineSession;
}

/**
 * Open an online session for sending invoices.
 * POST /sessions/online
 *
 * Generates AES key, encrypts it with KSeF public key, sends to API.
 * The same AES key is used for all invoices in this session.
 */
export async function openOnlineSession(
  accessToken: string,
  formCode?: { systemCode: string; schemaVersion: string; value: string },
): Promise<OnlineSessionInfo> {
  log("info", "Otwieranie sesji interaktywnej (online)");

  // Generate AES-256 key for this session
  const aesKey = generateAesKey();
  const iv = Buffer.from(Array(16).fill(0)); // Use zero IV for session encryption key

  // Encrypt AES key with KSeF public key (SymmetricKeyEncryption)
  const publicKey = await getKsefPublicKey("SymmetricKeyEncryption");
  const encryptedKey = encryptWithRsaOaep(aesKey, publicKey);

  const body = {
    formCode: formCode ?? {
      systemCode: "FA (3)",
      schemaVersion: "1-0E",
      value: "FA",
    },
    encryption: {
      encryptedSymmetricKey: encryptedKey.toString("base64"),
      initializationVector: iv.toString("base64"),
    },
  };

  const response = await ksefRequest<{ referenceNumber: string; validUntil: string }>(
    "POST",
    "/sessions/online",
    body,
    { sessionToken: accessToken },
  );

  activeOnlineSession = {
    referenceNumber: response.referenceNumber,
    validUntil: response.validUntil,
    aesKey,
    iv,
  };

  log("info", `Sesja online otwarta: ${response.referenceNumber}, ważna do: ${response.validUntil}`);
  return activeOnlineSession;
}

/**
 * Close an online session.
 * POST /sessions/online/{referenceNumber}/close
 */
export async function closeOnlineSession(
  accessToken: string,
  referenceNumber?: string,
): Promise<void> {
  const ref = referenceNumber ?? activeOnlineSession?.referenceNumber;
  if (!ref) throw new Error("Brak aktywnej sesji online do zamknięcia.");

  log("info", `Zamykanie sesji online: ${ref}`);

  await ksefRequest(
    "POST",
    `/sessions/online/${ref}/close`,
    undefined,
    { sessionToken: accessToken },
  );

  if (activeOnlineSession?.referenceNumber === ref) {
    activeOnlineSession = null;
  }

  log("info", "Sesja online zamknięta");
}

// ─── Invoice Sending ────────────────────────────────────────────────────────────

/**
 * Encrypt invoice XML and send to KSeF within an online session.
 *
 * Flow:
 * 1. Encrypt XML with session AES key (AES-256-CBC)
 * 2. POST /sessions/online/{ref}/invoices
 */
export async function sendEncryptedInvoice(
  accessToken: string,
  invoiceXml: string,
  onlineSession?: OnlineSessionInfo,
): Promise<SendInvoiceResult> {
  const session = onlineSession ?? activeOnlineSession;
  if (!session) {
    throw new Error(
      "Brak aktywnej sesji online. Użyj ksef_session_open lub openOnlineSession() najpierw.",
    );
  }

  log("info", "Szyfrowanie i wysyłanie faktury");

  const xmlBuffer = Buffer.from(invoiceXml, "utf-8");

  // Encrypt with session AES key
  const { ciphertext, iv } = encryptAes256Cbc(xmlBuffer, session.aesKey);

  // Compute hashes (SHA-256 Base64, as required by v2)
  const invoiceHash = sha256base64(xmlBuffer);
  const encryptedInvoiceHash = sha256base64(ciphertext);

  const body = {
    invoiceHash,
    invoiceSize: xmlBuffer.length,
    encryptedInvoiceHash,
    encryptedInvoiceSize: ciphertext.length,
    encryptedInvoiceContent: ciphertext.toString("base64"),
  };

  const response = await ksefRequest<SendInvoiceResult>(
    "POST",
    `/sessions/online/${session.referenceNumber}/invoices`,
    body,
    { sessionToken: accessToken },
  );

  log("info", `Faktura wysłana, ref: ${response.referenceNumber}`);
  return response;
}

// ─── Session Status & Invoice Status ────────────────────────────────────────────

/**
 * Get session status (works for both online and batch sessions).
 * GET /sessions/{referenceNumber}
 */
export async function getSessionStatus(
  accessToken: string,
  referenceNumber: string,
): Promise<SessionStatusResponse> {
  return ksefRequest<SessionStatusResponse>(
    "GET",
    `/sessions/${referenceNumber}`,
    undefined,
    { sessionToken: accessToken },
  );
}

/**
 * Get invoice processing status within a session.
 * GET /sessions/{sessionRef}/invoices/{invoiceRef}
 */
export async function getInvoiceProcessingStatus(
  accessToken: string,
  sessionReferenceNumber: string,
  invoiceReferenceNumber: string,
): Promise<SessionInvoiceStatusResponse> {
  return ksefRequest<SessionInvoiceStatusResponse>(
    "GET",
    `/sessions/${sessionReferenceNumber}/invoices/${invoiceReferenceNumber}`,
    undefined,
    { sessionToken: accessToken },
  );
}

/**
 * Get UPO for an invoice from a session.
 * GET /sessions/{sessionRef}/invoices/{invoiceRef}/upo
 */
export async function getInvoiceUpo(
  accessToken: string,
  sessionReferenceNumber: string,
  invoiceReferenceNumber: string,
): Promise<string> {
  const { config: cfg } = await import("../../utils/config.js");
  const url = `${cfg.baseUrl}/sessions/${sessionReferenceNumber}/invoices/${invoiceReferenceNumber}/upo`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/xml",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}
