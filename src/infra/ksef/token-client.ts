import { ksefRequest } from "./client.js";
import { log } from "../../utils/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface GenerateTokenParams {
  description: string;
  permissions: string[];
}

export interface GenerateTokenResponse {
  referenceNumber: string;
  token: string; // In v2, token value IS returned directly
}

export interface TokenListParams {
  pageSize?: number;
  continuationToken?: string;
}

export interface TokenListItem {
  referenceNumber: string;
  description?: string;
  status?: string;
  dateCreated?: string;
  lastUsedAt?: string;
  permissions?: string[];
}

export interface TokenListResponse {
  tokens: TokenListItem[];
  continuationToken?: string;
}

export interface TokenStatusResponse {
  referenceNumber: string;
  description: string;
  status: string;
  authorIdentifier?: {
    type: string;
    value: string;
  };
  contextIdentifier?: {
    type: string;
    value: string;
  };
  dateCreated?: string;
  requestedPermissions?: string[];
}

// ─── Token Management API (v2) ──────────────────────────────────────────────────

/**
 * Generate a new KSeF API token.
 * POST /tokens
 *
 * In v2, the token value IS returned in the response.
 */
export async function generateKsefToken(
  accessToken: string,
  params: GenerateTokenParams,
): Promise<GenerateTokenResponse> {
  log("info", `Generating KSeF token: ${params.description}`);

  return ksefRequest<GenerateTokenResponse>(
    "POST",
    "/tokens",
    {
      description: params.description,
      permissions: params.permissions,
    },
    { sessionToken: accessToken },
  );
}

/**
 * List KSeF tokens.
 * GET /tokens
 */
export async function listKsefTokens(
  accessToken: string,
  params?: TokenListParams,
): Promise<TokenListResponse> {
  log("info", "Listing KSeF tokens");

  const queryParts: string[] = [];
  if (params?.pageSize) queryParts.push(`pageSize=${params.pageSize}`);
  if (params?.continuationToken) {
    queryParts.push(`x-continuation-token=${encodeURIComponent(params.continuationToken)}`);
  }
  const query = queryParts.length > 0 ? `?${queryParts.join("&")}` : "";

  return ksefRequest<TokenListResponse>(
    "GET",
    `/tokens${query}`,
    undefined,
    { sessionToken: accessToken },
  );
}

/**
 * Get details of a specific KSeF token.
 * GET /tokens/{referenceNumber}
 */
export async function getKsefToken(
  accessToken: string,
  referenceNumber: string,
): Promise<TokenStatusResponse> {
  log("info", `Getting KSeF token status: ${referenceNumber}`);

  return ksefRequest<TokenStatusResponse>(
    "GET",
    `/tokens/${referenceNumber}`,
    undefined,
    { sessionToken: accessToken },
  );
}

/**
 * Revoke a KSeF token.
 * DELETE /tokens/{referenceNumber}
 */
export async function revokeKsefToken(
  accessToken: string,
  referenceNumber: string,
): Promise<void> {
  log("info", `Revoking KSeF token: ${referenceNumber}`);

  await ksefRequest(
    "DELETE",
    `/tokens/${referenceNumber}`,
    undefined,
    { sessionToken: accessToken },
  );
}
