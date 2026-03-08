import { z } from "zod";
import { registerTool } from "./registry.js";
import { toolResult, toolError } from "../utils/errors.js";
import { requireSession } from "../infra/ksef/auth.js";
import { auditLog, hashNip } from "../domain/audit.js";
import {
  openBatchSession,
  sendBatchPart,
  closeBatchSession,
  getBatchStatus,
} from "../infra/ksef/batch.js";

// ─── Schemas ────────────────────────────────────────────────────────────────────

const BatchOpenInput = z.object({
  formCode: z.string().optional().describe("Kod formularza (domyślnie 'FA')"),
});

const BatchSendPartInput = z.object({
  referenceNumber: z.string().describe("Numer referencyjny sesji batch"),
  partNumber: z.number().int().min(1).describe("Numer części (od 1)"),
  payload: z.string().describe("Zaszyfrowany ZIP jako Base64"),
});

const BatchRefInput = z.object({
  referenceNumber: z.string().describe("Numer referencyjny sesji batch"),
});

// ─── Tools ──────────────────────────────────────────────────────────────────────

registerTool(
  {
    name: "ksef_batch_open",
    description:
      "Otwórz sesję batch do wysyłania wielu faktur jednocześnie. " +
      "Wymaga aktywnej sesji KSeF. Zwraca numer referencyjny sesji batch.",
    inputSchema: {
      type: "object",
      properties: {
        formCode: {
          type: "string",
          description: "Kod formularza (domyślnie 'FA')",
        },
      },
    },
  },
  async (args) => {
    const startMs = Date.now();
    const input = BatchOpenInput.parse(args);
    const session = requireSession();
    const formCode = input.formCode || "FA";

    try {
      const result = await openBatchSession(session.token, formCode);

      auditLog({
        action: "batch_session_opened",
        toolName: "ksef_batch_open",
        nipHash: hashNip(session.nip),
        ksefReferenceNumber: result.referenceNumber,
        status: "success",
        details: `formCode: ${formCode}`,
        durationMs: Date.now() - startMs,
      });

      return toolResult({
        status: "sesja_batch_otwarta",
        referenceNumber: result.referenceNumber,
        processingCode: result.processingCode,
        processingDescription: result.processingDescription,
        hint: "Użyj ksef_batch_send_part do wysyłania części, potem ksef_batch_close.",
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
      "Wyślij część (part) zaszyfrowanego ZIP-a z fakturami w sesji batch. " +
      "Wymaga aktywnej sesji KSeF i otwartej sesji batch.",
    inputSchema: {
      type: "object",
      properties: {
        referenceNumber: {
          type: "string",
          description: "Numer referencyjny sesji batch",
        },
        partNumber: {
          type: "number",
          description: "Numer części (od 1)",
        },
        payload: {
          type: "string",
          description: "Zaszyfrowany ZIP jako Base64",
        },
      },
      required: ["referenceNumber", "partNumber", "payload"],
    },
    annotations: { destructiveHint: true },
  },
  async (args) => {
    const startMs = Date.now();
    const input = BatchSendPartInput.parse(args);
    const session = requireSession();

    try {
      const result = await sendBatchPart(
        session.token,
        input.referenceNumber,
        input.partNumber,
        input.payload,
      );

      auditLog({
        action: "batch_part_sent",
        toolName: "ksef_batch_send_part",
        nipHash: hashNip(session.nip),
        ksefReferenceNumber: input.referenceNumber,
        status: "success",
        details: `part: ${input.partNumber}`,
        durationMs: Date.now() - startMs,
      });

      return toolResult({
        status: "czesc_wyslana",
        referenceNumber: result.referenceNumber,
        partNumber: result.partNumber,
        processingCode: result.processingCode,
        processingDescription: result.processingDescription,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      auditLog({
        action: "batch_part_send_failed",
        toolName: "ksef_batch_send_part",
        nipHash: hashNip(session.nip),
        ksefReferenceNumber: input.referenceNumber,
        status: "error",
        details: `part: ${input.partNumber}, error: ${msg}`,
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
      const result = await closeBatchSession(session.token, input.referenceNumber);

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
        referenceNumber: result.referenceNumber,
        processingCode: result.processingCode,
        processingDescription: result.processingDescription,
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
      "Sprawdź status sesji batch. " +
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
    annotations: { readOnlyHint: true },
  },
  async (args) => {
    const input = BatchRefInput.parse(args);
    const session = requireSession();

    try {
      const result = await getBatchStatus(session.token, input.referenceNumber);

      return toolResult({
        status: "status_batch",
        referenceNumber: result.referenceNumber,
        processingCode: result.processingCode,
        processingDescription: result.processingDescription,
        numberOfInvoices: result.numberOfInvoices,
        numberOfParts: result.numberOfParts,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return toolError(`Błąd sprawdzania statusu batch: ${msg}`);
    }
  },
);
