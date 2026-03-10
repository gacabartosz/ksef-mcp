import { ksefRequest } from "./client.js";
import { encryptWithRsaOaep, generateAesKey, getKsefPublicKey, sha256base64 } from "./crypto.js";
import { log } from "../../utils/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface BatchSessionResponse {
  referenceNumber: string;
  partUploadRequests: Array<{
    ordinalNumber: number;
    method: string;
    url: string;
    headers: Record<string, string>;
  }>;
}

export interface BatchStatusResponse {
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

export interface BatchFilePartInfo {
  ordinalNumber: number;
  partSize: number;
  partHash: string; // SHA-256 Base64
}

// ─── Batch Session API (v2) ─────────────────────────────────────────────────────

/**
 * Open a batch session for sending multiple invoices.
 * POST /sessions/batch
 *
 * In v2, batch upload uses pre-signed URLs returned by the API.
 */
export async function openBatchSession(
  accessToken: string,
  fileSize: number,
  fileHash: string,
  fileParts: BatchFilePartInfo[],
  formCode?: { systemCode: string; schemaVersion: string; value: string },
): Promise<BatchSessionResponse> {
  log("info", `Opening batch session, parts: ${fileParts.length}`);

  // Generate AES key for batch encryption
  const aesKey = generateAesKey();
  const publicKey = await getKsefPublicKey("SymmetricKeyEncryption");
  const encryptedKey = encryptWithRsaOaep(aesKey, publicKey);
  const iv = Buffer.alloc(16, 0);

  const body = {
    formCode: formCode ?? {
      systemCode: "FA (3)",
      schemaVersion: "1-0E",
      value: "FA",
    },
    batchFile: {
      fileSize,
      fileHash,
      fileParts: fileParts.map((p) => ({
        ordinalNumber: p.ordinalNumber,
        partSize: p.partSize,
        partHash: p.partHash,
      })),
    },
    encryption: {
      encryptedSymmetricKey: encryptedKey.toString("base64"),
      initializationVector: iv.toString("base64"),
    },
  };

  return ksefRequest<BatchSessionResponse>(
    "POST",
    "/sessions/batch",
    body,
    { sessionToken: accessToken },
  );
}

/**
 * Upload a batch part to a pre-signed URL.
 * Uses the URL and headers from the partUploadRequests in openBatchSession response.
 */
export async function uploadBatchPart(
  uploadRequest: { method: string; url: string; headers: Record<string, string> },
  payload: Buffer,
): Promise<void> {
  log("info", `Uploading batch part to pre-signed URL`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000); // 2 min for large parts

  try {
    const response = await fetch(uploadRequest.url, {
      method: uploadRequest.method,
      headers: uploadRequest.headers,
      body: new Uint8Array(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Batch part upload failed: HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Close a batch session after all parts have been uploaded.
 * POST /sessions/batch/{referenceNumber}/close
 */
export async function closeBatchSession(
  accessToken: string,
  referenceNumber: string,
): Promise<void> {
  log("info", `Closing batch session: ${referenceNumber}`);

  await ksefRequest(
    "POST",
    `/sessions/batch/${referenceNumber}/close`,
    undefined,
    { sessionToken: accessToken },
  );
}

/**
 * Get the status of a batch/online session.
 * GET /sessions/{referenceNumber}
 */
export async function getBatchStatus(
  accessToken: string,
  referenceNumber: string,
): Promise<BatchStatusResponse> {
  log("info", `Checking session status: ${referenceNumber}`);

  return ksefRequest<BatchStatusResponse>(
    "GET",
    `/sessions/${referenceNumber}`,
    undefined,
    { sessionToken: accessToken },
  );
}
