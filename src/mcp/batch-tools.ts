import { z } from "zod";
import { registerTool } from "./registry.js";
import { toolResult, toolError } from "../utils/errors.js";
import { requireSession } from "../infra/ksef/auth.js";
import { auditLog, hashNip } from "../domain/audit.js";
import {
  openBatchSession,
  uploadBatchPart,
  closeBatchSession,
  getBatchStatus,
} from "../infra/ksef/batch.js";

// ─── Schemas ────────────────────────────────────────────────────────────────────

const BatchOpenInput = z.object({
  fileSize: z.number().int().min(1).describe("Rozmiar pliku paczki w bajtach"),
  fileHash: z.string().describe("SHA-256 Base64 hash pliku paczki"),
  fileParts: z.array(z.object({
    ordinalNumber: z.number().int().min(1),
    partSize: z.number().int().min(1),
    partHash: z.string(),
  })).min(1).describe("Lista części pliku paczki"),
  formCode: z.string().optional().describe("Kod formularza (domyślnie 'FA')"),
});

const BatchUploadPartInput = z.object({
  referenceNumber: z.string().describe("Numer referencyjny sesji batch"),
  ordinalNumber: z.number().int().min(1).describe("Numer porządkowy części"),
  uploadUrl: z.string().describe("Pre-signed URL do uploadu"),
  uploadMethod: z.string().optional().describe("Metoda HTTP (domyślnie PUT)"),
  uploadHeaders: z.record(z.string()).optional().describe("Nagłówki do uploadu"),
  payload: z.string().describe("Zaszyfrowane dane części jako Base64"),
});

const BatchRefInput = z.object({
  referenceNumber: z.string().describe("Numer referencyjny sesji batch"),
});

// ─── Tools ──────────────────────────────────────────────────────────────────────

registerTool(
  {
    name: "ksef_batch_open",
    description:
      "Otwórz sesję batch do wysyłania wielu faktur jednocześnie (API v2). " +
      "Wymaga aktywnej sesji KSeF. Podaj rozmiar pliku, hash i listę części. " +
      "Zwraca numer referencyjny i pre-signed URLs do uploadu części.",
    inputSchema: {
      type: "object",
      properties: {
        fileSize: { type: "number", description: "Rozmiar pliku paczki w bajtach" },
        fileHash: { type: "string", description: "SHA-256 Base64 hash pliku paczki" },
        fileParts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ordinalNumber: { type: "number", description: "Numer porządkowy części (od 1)" },
              partSize: { type: "number", description: "Rozmiar części w bajtach" },
              partHash: { type: "string", description: "SHA-256 Base64 hash części" },
            },
            required: ["ordinalNumber", "partSize", "partHash"],
          },
          description: "Lista części pliku paczki",
        },
        formCode: { type: "string", description: "Kod formularza (domyślnie 'FA')" },
      },
      required: ["fileSize", "fileHash", "fileParts"],
    },
  },
  async (args) => {
    const startMs = Date.now();
    const input = BatchOpenInput.parse(args);
    const session = requireSession();

    try {
      const result = await openBatchSession(
        session.accessToken,
        input.fileSize,
        input.fileHash,
        input.fileParts,
      );

      auditLog({
        action: "batch_session_opened",
        toolName: "ksef_batch_open",
        nipHash: hashNip(session.nip),
        ksefReferenceNumber: result.referenceNumber,
        status: "success",
        details: `parts: ${input.fileParts.length}`,
        durationMs: Date.now() - startMs,
      });

      return toolResult({
        status: "sesja_batch_otwarta",
        referenceNumber: result.referenceNumber,
        partUploadRequests: result.partUploadRequests,
        hint: "Użyj pre-signed URLs do uploadu części, potem ksef_batch_close.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      auditLog({
        action: "batch_session_open_failed",
        toolName: "ksef_batch_open",
        nipHash: hashNip(session.nip),
        status: "error",
        details: msg,
        durationMs: Date.now() - startMs,
      });

      return toolError(`Błąd otwierania sesji batch: ${msg}`);
    }
  },
);

registerTool(
  {
    name: "ksef_batch_send_part",
    description:
      "Wyślij część paczki na pre-signed URL uzyskany z ksef_batch_open. " +
      "Wymaga aktywnej sesji KSeF i otwartej sesji batch.",
    inputSchema: {
      type: "object",
      properties: {
        referenceNumber: { type: "string", description: "Numer referencyjny sesji batch" },
        ordinalNumber: { type: "number", description: "Numer porządkowy części (od 1)" },
        uploadUrl: { type: "string", description: "Pre-signed URL do uploadu" },
        uploadMethod: { type: "string", description: "Metoda HTTP (domyślnie PUT)" },
        uploadHeaders: {
          type: "object",
          description: "Nagłówki do uploadu (z partUploadRequests)",
        },
        payload: { type: "string", description: "Zaszyfrowane dane części jako Base64" },
      },
      required: ["referenceNumber", "ordinalNumber", "uploadUrl", "payload"],
    },
    annotations: { destructiveHint: true },
  },
  async (args) => {
    const startMs = Date.now();
    const input = BatchUploadPartInput.parse(args);
    const session = requireSession();

    try {
      await uploadBatchPart(
        {
          method: input.uploadMethod || "PUT",
          url: input.uploadUrl,
          headers: input.uploadHeaders || {},
        },
        Buffer.from(input.payload, "base64"),
      );

      auditLog({
        action: "batch_part_sent",
        toolName: "ksef_batch_send_part",
        nipHash: hashNip(session.nip),
        ksefReferenceNumber: input.referenceNumber,
        status: "success",
        details: `part: ${input.ordinalNumber}`,
        durationMs: Date.now() - startMs,
      });

      return toolResult({
        status: "czesc_wyslana",
        referenceNumber: input.referenceNumber,
        ordinalNumber: input.ordinalNumber,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      auditLog({
        action: "batch_part_send_failed",
        toolName: "ksef_batch_send_part",
        nipHash: hashNip(session.nip),
        ksefReferenceNumber: input.referenceNumber,
        status: "error",
        details: `part: ${input.ordinalNumber}, error: ${msg}`,
        durationMs: Date.now() - startMs,
      });

      return toolError(`Błąd wysyłania części batch: ${msg}`);
    }
  },
);

registerTool(
  {
    name: "ksef_batch_close",
    description:
      "Zamknij sesję batch po wysłaniu wszystkich części. " +
      "Wymaga aktywnej sesji KSeF.",
    inputSchema: {
      type: "object",
      properties: {
        referenceNumber: {
          type: "string",
          description: "Numer referencyjny sesji batch",
        },
      },
      required: ["referenceNumber"],
    },
    annotations: { destructiveHint: true },
  },
  async (args) => {
    const startMs = Date.now();
    const input = BatchRefInput.parse(args);
    const session = requireSession();

    try {
      await closeBatchSession(session.accessToken, input.referenceNumber);

      auditLog({
        action: "batch_session_closed",
        toolName: "ksef_batch_close",
        nipHash: hashNip(session.nip),
        ksefReferenceNumber: input.referenceNumber,
        status: "success",
        durationMs: Date.now() - startMs,
      });

      return toolResult({
        status: "sesja_batch_zamknieta",
        referenceNumber: input.referenceNumber,
        hint: "Sprawdź status przetwarzania: ksef_batch_status.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      auditLog({
        action: "batch_session_close_failed",
        toolName: "ksef_batch_close",
        nipHash: hashNip(session.nip),
        ksefReferenceNumber: input.referenceNumber,
        status: "error",
        details: msg,
        durationMs: Date.now() - startMs,
      });

      return toolError(`Błąd zamykania sesji batch: ${msg}`);
    }
  },
);

registerTool(
  {
    name: "ksef_batch_status",
    description:
      "Sprawdź status sesji batch (lub online). " +
      "Wymaga aktywnej sesji KSeF.",
    inputSchema: {
      type: "object",
      properties: {
        referenceNumber: {
          type: "string",
          description: "Numer referencyjny sesji batch/online",
        },
      },
      required: ["referenceNumber"],
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const input = BatchRefInput.parse(args);
    const session = requireSession();

    try {
      const result = await getBatchStatus(session.accessToken, input.referenceNumber);

      return toolResult({
        status: "status_sesji",
        referenceNumber: input.referenceNumber,
        sessionStatus: result.status,
        dateCreated: result.dateCreated,
        dateUpdated: result.dateUpdated,
        invoiceCount: result.invoiceCount,
        successfulInvoiceCount: result.successfulInvoiceCount,
        failedInvoiceCount: result.failedInvoiceCount,
        upo: result.upo,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(`Błąd sprawdzania statusu sesji: ${msg}`);
    }
  },
);
