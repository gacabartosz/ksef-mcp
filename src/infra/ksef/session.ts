import { ksefRequest } from "./client.js";
import { encryptAes256Cbc, encryptWithRsaOaep, generateAesKey, getKsefPublicKey } from "./crypto.js";
import { log } from "../../utils/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface SendInvoiceResult {
  elementReferenceNumber: string;
  referenceNumber?: string;
  processingCode: number;
  processingDescription: string;
}

export interface InvoiceStatusResult {
  processingCode: number;
  processingDescription: string;
  elementReferenceNumber: string;
  invoiceStatus?: {
    invoiceNumber?: string;
    ksefReferenceNumber?: string;
    acquisitionTimestamp?: string;
  };
}

// ─── Invoice Sending ────────────────────────────────────────────────────────────

/**
 * Encrypt invoice XML and send to KSeF.
 *
 * Flow:
 * 1. Generate random AES-256 key
 * 2. Encrypt invoice XML with AES-256-CBC
 * 3. Encrypt AES key with KSeF RSA public key (OAEP + SHA-256)
 * 4. POST /online/Invoice/Send with encrypted payload
 */
export async function sendEncryptedInvoice(
  sessionToken: string,
  invoiceXml: string,
): Promise<SendInvoiceResult> {
  log("info", "Encrypting invoice for KSeF send");

  // Step 1: Generate AES key
  const aesKey = generateAesKey();

  // Step 2: Encrypt XML with AES-256-CBC
  const xmlBuffer = Buffer.from(invoiceXml, "utf-8");
  const { ciphertext, iv } = encryptAes256Cbc(xmlBuffer, aesKey);

  // Step 3: Encrypt AES key with KSeF public RSA key
  const publicKey = await getKsefPublicKey();
  const encryptedKey = encryptWithRsaOaep(aesKey, publicKey);

  // Step 4: Build and send the request
  const body = {
    invoiceHash: {
      hashSHA: {
        algorithm: "SHA-256",
        encoding: "Base64",
        value: Buffer.from(
          await import("node:crypto").then((c) =>
            c.createHash("sha256").update(xmlBuffer).digest(),
          ),
        ).toString("base64"),
      },
      fileSize: xmlBuffer.length,
    },
    invoicePayload: {
      type: "encrypted",
      encryptedInvoiceHash: {
        hashSHA: {
          algorithm: "SHA-256",
          encoding: "Base64",
          value: Buffer.from(
            await import("node:crypto").then((c) =>
              c.createHash("sha256").update(ciphertext).digest(),
            ),
          ).toString("base64"),
        },
        fileSize: ciphertext.length,
      },
      encryptedInvoiceBody: ciphertext.toString("base64"),
      encryptionKey: {
        encryptedSymmetricKey: encryptedKey.toString("base64"),
        initializationVector: iv.toString("base64"),
        encryptionAlgorithmKey: "RSA",
        encryptionAlgorithmBody: "AES-256-CBC",
      },
    },
  };

  log("info", "Sending encrypted invoice to KSeF");

  const response = await ksefRequest<SendInvoiceResult>(
    "POST",
    "/online/Invoice/Send",
    body,
    { sessionToken },
  );

  log("info", `Invoice sent, elementRef: ${response.elementReferenceNumber}`);
  return response;
}

/**
 * Check invoice processing status in KSeF.
 * GET /online/Invoice/Status/{elementReferenceNumber}
 */
export async function getInvoiceProcessingStatus(
  sessionToken: string,
  elementReferenceNumber: string,
): Promise<InvoiceStatusResult> {
  log("info", `Checking invoice status: ${elementReferenceNumber}`);

  return ksefRequest<InvoiceStatusResult>(
    "GET",
    `/online/Invoice/Status/${elementReferenceNumber}`,
    undefined,
    { sessionToken },
  );
}
