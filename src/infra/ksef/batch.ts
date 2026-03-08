import { ksefRequest } from "./client.js";
import { log } from "../../utils/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface BatchSessionResponse {
  referenceNumber: string;
  processingCode: number;
  processingDescription: string;
}

export interface BatchPartResponse {
  referenceNumber: string;
  partNumber: number;
  processingCode: number;
  processingDescription: string;
}

export interface BatchTerminateResponse {
  referenceNumber: string;
  processingCode: number;
  processingDescription: string;
}

export interface BatchStatusResponse {
  referenceNumber: string;
  processingCode: number;
  processingDescription: string;
  numberOfInvoices?: number;
  numberOfParts?: number;
}

// ─── Batch Session API ──────────────────────────────────────────────────────────

/**
 * Open a batch session for sending multiple invoices.
 * POST /online/Session/InitBatch
 */
export async function openBatchSession(
  sessionToken: string,
  formCode: string,
): Promise<BatchSessionResponse> {
  log("info", `Opening batch session, formCode: ${formCode}`);

  return ksefRequest<BatchSessionResponse>(
    "POST",
    "/online/Session/InitBatch",
    { formCode },
    { sessionToken },
  );
}

/**
 * Send a batch part (encrypted ZIP of invoices).
 * POST /online/Session/SendBatch/{referenceNumber}/Parts/{partNumber}
 */
export async function sendBatchPart(
  sessionToken: string,
  referenceNumber: string,
  partNumber: number,
  payload: string,
): Promise<BatchPartResponse> {
  log("info", `Sending batch part ${partNumber} for ref: ${referenceNumber}`);

  return ksefRequest<BatchPartResponse>(
    "POST",
    `/online/Session/SendBatch/${referenceNumber}/Parts/${partNumber}`,
    payload,
    {
      sessionToken,
      contentType: "application/octet-stream",
      rawBody: true,
    },
  );
}

/**
 * Close a batch session after all parts have been sent.
 * POST /online/Session/TerminateBatch/{referenceNumber}
 */
export async function closeBatchSession(
  sessionToken: string,
  referenceNumber: string,
): Promise<BatchTerminateResponse> {
  log("info", `Closing batch session: ${referenceNumber}`);

  return ksefRequest<BatchTerminateResponse>(
    "POST",
    `/online/Session/TerminateBatch/${referenceNumber}`,
    undefined,
    { sessionToken },
  );
}

/**
 * Get the status of a batch session.
 * GET /online/Session/StatusBatch/{referenceNumber}
 */
export async function getBatchStatus(
  sessionToken: string,
  referenceNumber: string,
): Promise<BatchStatusResponse> {
  log("info", `Checking batch status: ${referenceNumber}`);

  return ksefRequest<BatchStatusResponse>(
    "GET",
    `/online/Session/StatusBatch/${referenceNumber}`,
    undefined,
    { sessionToken },
  );
}
