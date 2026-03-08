import { appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../utils/config.js";
import { sha256hex } from "../infra/ksef/crypto.js";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;                // e.g. 'draft_created', 'invoice_sent', 'approval_confirmed'
  toolName: string;
  environment: string;
  nipHash: string;               // SHA-256 of NIP (don't store raw NIP)
  draftId?: string;
  approvalId?: string;
  ksefReferenceNumber?: string;
  payloadHash?: string;
  status: "success" | "error";
  details?: string;
  durationMs?: number;
}

// ─── Store ──────────────────────────────────────────────────────────────────────

function getAuditPath(): string {
  return `${config.dataDir}/audit.jsonl`;
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Append an entry to the audit log (JSONL format).
 * This is append-only — entries are never modified or deleted.
 */
export function auditLog(
  entry: Omit<AuditEntry, "id" | "timestamp" | "environment">,
): AuditEntry {
  const full: AuditEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    environment: config.env,
    ...entry,
  };

  const path = getAuditPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(full) + "\n", { mode: 0o600 });

  return full;
}

/**
 * Hash a NIP for audit storage (never store raw NIP in audit log).
 */
export function hashNip(nip: string): string {
  return sha256hex(Buffer.from(nip));
}

/**
 * Read the last N entries from the audit log.
 */
export function readAuditLog(limit: number = 20): AuditEntry[] {
  const path = getAuditPath();

  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return [];
  }

  const lines = content.trim().split("\n").filter(Boolean);

  // Take last N lines
  const tail = lines.slice(-limit);

  const entries: AuditEntry[] = [];
  for (const line of tail) {
    try {
      entries.push(JSON.parse(line) as AuditEntry);
    } catch {
      // skip malformed lines
    }
  }

  // Return in reverse chronological order
  return entries.reverse();
}
