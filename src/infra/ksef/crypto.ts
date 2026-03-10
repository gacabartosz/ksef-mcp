import { publicEncrypt, constants, createCipheriv, createHash, randomBytes, X509Certificate } from "node:crypto";
import { ksefRequest } from "./client.js";
import { log } from "../../utils/logger.js";

// Cache: usage → PEM string
const cachedPublicKeys = new Map<string, string>();

interface PublicKeyCertificate {
  certificate: string; // DER Base64
  validFrom: string;
  validTo: string;
  usage: string[]; // "KsefTokenEncryption" | "SymmetricKeyEncryption"
}

/**
 * Get KSeF public key certificate for a specific usage.
 * GET /security/public-key-certificates
 *
 * @param usage — "KsefTokenEncryption" (for auth) or "SymmetricKeyEncryption" (for invoice encryption)
 */
export async function getKsefPublicKey(usage: "KsefTokenEncryption" | "SymmetricKeyEncryption" = "SymmetricKeyEncryption"): Promise<string> {
  const cached = cachedPublicKeys.get(usage);
  if (cached) return cached;

  log("info", `Pobieranie klucza publicznego KSeF (${usage})`);

  const certs = await ksefRequest<PublicKeyCertificate[]>(
    "GET",
    "/security/public-key-certificates",
  );

  // Find valid cert for the requested usage
  const now = new Date();
  const cert = certs.find((c) =>
    c.usage.includes(usage) &&
    new Date(c.validFrom) <= now &&
    new Date(c.validTo) >= now,
  );

  if (!cert) {
    throw new Error(
      `Nie znaleziono ważnego certyfikatu KSeF dla ${usage}. ` +
      `Dostępne: ${certs.map((c) => c.usage.join(",")).join("; ")}`,
    );
  }

  // Convert DER Base64 to PEM public key
  const derBuffer = Buffer.from(cert.certificate, "base64");

  let publicKeyPem: string;
  try {
    // Try parsing as X.509 certificate to extract public key
    const x509 = new X509Certificate(derBuffer);
    publicKeyPem = x509.publicKey.export({ type: "spki", format: "pem" }) as string;
  } catch {
    // Fallback: treat as raw DER public key
    const b64Lines = cert.certificate.match(/.{1,64}/g)?.join("\n") ?? cert.certificate;
    publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${b64Lines}\n-----END PUBLIC KEY-----`;
  }

  cachedPublicKeys.set(usage, publicKeyPem);
  log("info", `Klucz publiczny KSeF pobrany (${usage}), ważny do: ${cert.validTo}`);
  return publicKeyPem;
}

/**
 * Encrypt with RSA-OAEP (SHA-256).
 */
export function encryptWithRsaOaep(plaintext: Buffer, publicKeyPem: string): Buffer {
  return publicEncrypt(
    {
      key: publicKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    plaintext,
  );
}

/**
 * Encrypt with AES-256-CBC (PKCS#7 padding).
 */
export function encryptAes256Cbc(
  plaintext: Buffer,
  key: Buffer,
): { ciphertext: Buffer; iv: Buffer } {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext: encrypted, iv };
}

/**
 * SHA-256 hex hash.
 */
export function sha256hex(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * SHA-256 Base64 hash (used by KSeF API v2).
 */
export function sha256base64(data: Buffer): string {
  return createHash("sha256").update(data).digest("base64");
}

/**
 * Generate random AES 256-bit key.
 */
export function generateAesKey(): Buffer {
  return randomBytes(32);
}
