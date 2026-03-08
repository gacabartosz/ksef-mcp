import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../utils/config.js";
import { log } from "../utils/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ApprovalRequest {
  id: string;
  type: "send_invoice" | "send_correction" | "revoke_token";
  draftId: string;
  payloadHash: string;        // SHA-256 of the XML to send
  previewSummary: string;     // human-readable summary
  status: "pending" | "confirmed" | "cancelled" | "expired";
  createdAt: string;
  expiresAt: string;          // 15 minutes from creation
  confirmedAt?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const APPROVAL_TTL_MS = 15 * 60 * 1000; // 15 minutes

// ─── Store ──────────────────────────────────────────────────────────────────────

function getApprovalsPath(): string {
  return `${config.dataDir}/approvals.json`;
}

function loadApprovals(): ApprovalRequest[] {
  try {
    const raw = readFileSync(getApprovalsPath(), "utf-8");
    return JSON.parse(raw) as ApprovalRequest[];
  } catch {
    return [];
  }
}

function saveApprovals(approvals: ApprovalRequest[]): void {
  const path = getApprovalsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(approvals, null, 2), { mode: 0o600 });
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function isExpired(approval: ApprovalRequest): boolean {
  return new Date(approval.expiresAt).getTime() < Date.now();
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Create a new approval request.
 * If config.approvalMode === 'auto', the approval is auto-confirmed immediately.
 */
export function createApproval(params: {
  type: ApprovalRequest["type"];
  draftId: string;
  payloadHash: string;
  previewSummary: string;
}): ApprovalRequest {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + APPROVAL_TTL_MS);

  const approval: ApprovalRequest = {
    id: randomUUID(),
    type: params.type,
    draftId: params.draftId,
    payloadHash: params.payloadHash,
    previewSummary: params.previewSummary,
    status: "pending",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  // Auto-confirm in auto mode (for testing)
  if (config.approvalMode === "auto") {
    approval.status = "confirmed";
    approval.confirmedAt = now.toISOString();
    log("info", `Approval auto-confirmed (approvalMode=auto): ${approval.id}`);
  }

  const approvals = loadApprovals();
  approvals.push(approval);
  saveApprovals(approvals);

  log("info", `Approval created: ${approval.id} for draft ${params.draftId} [${approval.status}]`);
  return approval;
}

/**
 * Confirm a pending approval.
 * Verifies the approval is still pending, not expired, and the payloadHash matches.
 */
export function confirmApproval(id: string, expectedHash: string): ApprovalRequest {
  const approvals = loadApprovals();
  const idx = approvals.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error(`Approval nie znalezione: ${id}`);

  const approval = approvals[idx];

  if (approval.status !== "pending") {
    throw new Error(`Approval ma status '${approval.status}' — można potwierdzić tylko 'pending'.`);
  }

  if (isExpired(approval)) {
    approval.status = "expired";
    approvals[idx] = approval;
    saveApprovals(approvals);
    throw new Error(`Approval wygasło (${approval.expiresAt}). Utwórz nowe.`);
  }

  if (approval.payloadHash !== expectedHash) {
    throw new Error(
      "Hash XML nie zgadza się z hashem w approval. " +
      "Draft mógł zostać zmodyfikowany. Utwórz nowe approval.",
    );
  }

  approval.status = "confirmed";
  approval.confirmedAt = new Date().toISOString();
  approvals[idx] = approval;
  saveApprovals(approvals);

  log("info", `Approval confirmed: ${id}`);
  return approval;
}

/**
 * Cancel a pending approval.
 */
export function cancelApproval(id: string): ApprovalRequest {
  const approvals = loadApprovals();
  const idx = approvals.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error(`Approval nie znalezione: ${id}`);

  const approval = approvals[idx];

  if (approval.status !== "pending") {
    throw new Error(`Approval ma status '${approval.status}' — można anulować tylko 'pending'.`);
  }

  approval.status = "cancelled";
  approvals[idx] = approval;
  saveApprovals(approvals);

  log("info", `Approval cancelled: ${id}`);
  return approval;
}

/**
 * Get a single approval by ID.
 */
export function getApproval(id: string): ApprovalRequest | undefined {
  const approvals = loadApprovals();
  const approval = approvals.find((a) => a.id === id);

  // Auto-expire if needed
  if (approval && approval.status === "pending" && isExpired(approval)) {
    approval.status = "expired";
    const all = loadApprovals();
    const idx = all.findIndex((a) => a.id === id);
    if (idx !== -1) {
      all[idx] = approval;
      saveApprovals(all);
    }
  }

  return approval;
}

/**
 * List all pending approvals (not expired).
 */
export function listPendingApprovals(): ApprovalRequest[] {
  const approvals = loadApprovals();
  const now = Date.now();
  let changed = false;

  const result: ApprovalRequest[] = [];

  for (const approval of approvals) {
    if (approval.status === "pending") {
      if (new Date(approval.expiresAt).getTime() < now) {
        approval.status = "expired";
        changed = true;
      } else {
        result.push(approval);
      }
    }
  }

  if (changed) {
    saveApprovals(approvals);
  }

  return result;
}

/**
 * Find a confirmed approval for a given draft with matching payload hash.
 */
export function findConfirmedApprovalForDraft(
  draftId: string,
  expectedHash: string,
): ApprovalRequest | undefined {
  const approvals = loadApprovals();
  return approvals.find(
    (a) =>
      a.draftId === draftId &&
      a.payloadHash === expectedHash &&
      a.status === "confirmed",
  );
}

/**
 * Clean up expired approvals older than 24 hours.
 */
export function cleanExpired(): number {
  const approvals = loadApprovals();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24h ago
  const before = approvals.length;

  const kept = approvals.filter((a) => {
    if (a.status === "expired" || a.status === "cancelled") {
      return new Date(a.createdAt).getTime() > cutoff;
    }
    return true;
  });

  const removed = before - kept.length;
  if (removed > 0) {
    saveApprovals(kept);
    log("info", `Cleaned ${removed} expired/cancelled approvals`);
  }

  return removed;
}
