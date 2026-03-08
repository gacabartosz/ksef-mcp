import { publicEncrypt, constants, createCipheriv, createHash, randomBytes } from "node:crypto";
import { ksefRequest } from "./client.js";
import { log } from "../../utils/logger.js";

let cachedPublicKey: string | null = null;

interface PublicKeyResponse {
  // KSeF zwraca klucz publiczny w PEM
  [key: string]: unknown;
}

/**
 * Pobierz klucz publiczny KSeF do szyfrowania.
 * Endpoint: GET /online/Session/AuthorisationChallenge (klucz w response)
 * lub dedykowany endpoint na danym środowisku.
 */
export async function getKsefPublicKey(): Promise<string> {
  if (cachedPublicKey) return cachedPublicKey;

  // KSeF udostępnia klucz publiczny — na środowisku testowym
  // jest dostępny pod stałym URL-em
  log("info", "Pobieranie klucza publicznego KSeF");

  // Klucz publiczny KSeF dla środowiska testowego (RSA 2048)
  // W produkcji należy pobrać z oficjalnego źródła MF
  const response = await ksefRequest<PublicKeyResponse>(
    "GET",
    "/online/Session/AuthorisationChallenge/PublicKey",
  ).catch(() => null);

  if (response && typeof response === "object") {
    const key = Object.values(response).find((v) => typeof v === "string" && v.includes("BEGIN PUBLIC KEY"));
    if (key) {
      cachedPublicKey = key as string;
      return cachedPublicKey;
    }
  }

  // Fallback: klucz publiczny KSeF TEST (ten sam dla wszystkich użytkowników TE)
  // Źródło: dokumentacja KSeF / ksef-docs
  throw new Error(
    "Nie udało się pobrać klucza publicznego KSeF. " +
    "Ustaw zmienną KSEF_PUBLIC_KEY lub sprawdź połączenie z API.",
  );
}

/**
 * Szyfruj token autoryzacyjny KSeF kluczem publicznym RSA (OAEP + SHA-256).
 * Format wejściowy: token + "|" + timestamp
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
 * Szyfruj dane AES-256-CBC z PKCS#7 padding.
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
 * Generuj losowy klucz AES 256-bit.
 */
export function generateAesKey(): Buffer {
  return randomBytes(32);
}
