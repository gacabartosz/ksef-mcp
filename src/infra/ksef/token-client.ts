import { ksefRequest } from "./client.js";
import { log } from "../../utils/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface GenerateTokenParams {
  description: string;
  permissions: string[];
}

export interface GenerateTokenResponse {
  referenceNumber: string;
  processingCode: number;
  processingDescription: string;
}

export interface TokenListParams {
  pageSize?: number;
  pageOffset?: number;
}

export interface TokenCredential {
  referenceNumber: string;
  description?: string;
  credentialStatus: string;
  createdAt?: string;
  lastUsedAt?: string;
}

export interface TokenListResponse {
  credentials: TokenCredential[];
  numberOfElements: number;
  pageSize: number;
  pageOffset: number;
}

export interface TokenStatusResponse {
  referenceNumber: string;
  description?: string;
  credentialStatus: string;
  createdAt?: string;
  lastUsedAt?: string;
  permissions?: string[];
}

export interface RevokeTokenResponse {
  referenceNumber: string;
  processingCode: number;
  processingDescription: string;
}

// ─── Token Management API ───────────────────────────────────────────────────────

/**
 * Generate a new KSeF API token.
 * POST /online/Credentials/GenerateToken
 *
 * IMPORTANT: The response contains only a referenceNumber,
 * NOT the token value itself. The token is delivered via KSeF.
 */
export async function generateKsefToken(
  sessionToken: string,
  params: GenerateTokenParams,
): Promise<GenerateTokenResponse> {
  log("info", `Generating KSeF token: ${params.description}`);

  return ksefRequest<GenerateTokenResponse>(
    "POST",
    "/online/Credentials/GenerateToken",
    {
      generateToken: {
        description: params.description,
        credentialPermissions: params.permissions,
      },
    },
    { sessionToken },
  );
}

/**
 * List KSeF tokens/credentials.
 * GET /online/Credentials/CredentialsList
 */
export async function listKsefTokens(
  sessionToken: string,
  params?: TokenListParams,
): Promise<TokenListResponse> {
  log("info", "Listing KSeF tokens");

  const queryParts: string[] = [];
  if (params?.pageSize) queryParts.push(`pageSize=${params.pageSize}`);
  if (params?.pageOffset) queryParts.push(`pageOffset=${params.pageOffset}`);
  const query = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";

  return ksefRequest<TokenListResponse>(
    "GET",
    `/online/Credentials/CredentialsList${query}`,
    undefined,
    { sessionToken },
  );
}

/**
 * Get details of a specific KSeF token.
 * GET /online/Credentials/Status/{referenceNumber}
 *
 * Returns metadata only — NEVER the token value.
 */
export async function getKsefToken(
  sessionToken: string,
  referenceNumber: string,
): Promise<TokenStatusResponse> {
  log("info", `Getting KSeF token status: ${referenceNumber}`);

  return ksefRequest<TokenStatusResponse>(
    "GET",
    `/online/Credentials/Status/${referenceNumber}`,
    undefined,
    { sessionToken },
  );
}

/**
 * Revoke a KSeF token.
 * DELETE /online/Credentials/Revoke/{referenceNumber}
 *
 * This is a destructive operation — the token cannot be restored.
 */
export async function revokeKsefToken(
  sessionToken: string,
  referenceNumber: string,
): Promise<RevokeTokenResponse> {
  log("info", `Revoking KSeF token: ${referenceNumber}`);

  return ksefRequest<RevokeTokenResponse>(
    "DELETE",
    `/online/Credentials/Revoke/${referenceNumber}`,
    undefined,
    { sessionToken },
  );
}
