import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "../utils/config.js";
import { log } from "../utils/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface InvoiceItem {
  name: string;
  quantity: number;
  unitPrice: number;       // net price per unit
  vatRate: number;          // e.g. 23, 8, 5, 0, -1 for "zw"
  unit?: string;            // default "szt."
  // Computed
  netAmount?: number;
  vatAmount?: number;
  grossAmount?: number;
}

export interface DraftInvoice {
  id: string;               // uuid
  status: "draft" | "validated" | "locked" | "sent" | "error";
  createdAt: string;
  updatedAt: string;
  // Seller
  sellerNip: string;
  sellerName: string;
  sellerAddress?: string;
  // Buyer
  buyerNip: string;
  buyerName: string;
  buyerAddress?: string;
  // Invoice data
  invoiceNumber: string;
  issueDate: string;        // YYYY-MM-DD
  sellDate?: string;        // YYYY-MM-DD
  currency: string;         // default PLN
  // Line items
  items: InvoiceItem[];
  // Computed
  totalNet?: number;
  totalVat?: number;
  totalGross?: number;
  // Correction fields
  correctionOf?: string;         // original draft ID
  correctionReason?: string;
  originalKsefRef?: string;      // original KSeF reference number
  // Send tracking
  ksefReferenceNumber?: string;
  xmlHash?: string;
  lockedAt?: string;
  sentAt?: string;
  errorMessage?: string;
}

// ─── Store ──────────────────────────────────────────────────────────────────────

function getDraftsPath(): string {
  return `${config.dataDir}/drafts.json`;
}

function loadDrafts(): DraftInvoice[] {
  try {
    const raw = readFileSync(getDraftsPath(), "utf-8");
    return JSON.parse(raw) as DraftInvoice[];
  } catch {
    return [];
  }
}

function saveDrafts(drafts: DraftInvoice[]): void {
  const path = getDraftsPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(drafts, null, 2), "utf-8");
}

// ─── Computed totals ────────────────────────────────────────────────────────────

export function computeTotals(draft: DraftInvoice): DraftInvoice {
  const items = draft.items.map((item) => {
    const netAmount = round2(item.quantity * item.unitPrice);
    const vatAmount = item.vatRate >= 0
      ? round2(netAmount * item.vatRate / 100)
      : 0; // "zw" (exempt) → vatRate = -1
    const grossAmount = round2(netAmount + vatAmount);
    return { ...item, netAmount, vatAmount, grossAmount };
  });

  const totalNet = round2(items.reduce((s, i) => s + (i.netAmount ?? 0), 0));
  const totalVat = round2(items.reduce((s, i) => s + (i.vatAmount ?? 0), 0));
  const totalGross = round2(totalNet + totalVat);

  return { ...draft, items, totalNet, totalVat, totalGross };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── CRUD ───────────────────────────────────────────────────────────────────────

export function createDraft(data: Omit<DraftInvoice, "id" | "status" | "createdAt" | "updatedAt" | "totalNet" | "totalVat" | "totalGross">): DraftInvoice {
  const now = new Date().toISOString();
  const draft: DraftInvoice = {
    ...data,
    id: randomUUID(),
    status: "draft",
    createdAt: now,
    updatedAt: now,
    currency: data.currency || "PLN",
    items: data.items || [],
  };

  const withTotals = computeTotals(draft);
  const drafts = loadDrafts();
  drafts.push(withTotals);
  saveDrafts(drafts);
  log("info", `Draft created: ${withTotals.id}`);
  return withTotals;
}

export function getDraft(id: string): DraftInvoice | undefined {
  const drafts = loadDrafts();
  return drafts.find((d) => d.id === id);
}

export function listDrafts(status?: string): DraftInvoice[] {
  const drafts = loadDrafts();
  if (status) {
    return drafts.filter((d) => d.status === status);
  }
  return drafts;
}

export function updateDraft(id: string, patch: Partial<DraftInvoice>): DraftInvoice {
  const drafts = loadDrafts();
  const idx = drafts.findIndex((d) => d.id === id);
  if (idx === -1) throw new Error(`Draft nie znaleziony: ${id}`);

  const existing = drafts[idx];
  if (existing.status === "locked" || existing.status === "sent") {
    throw new Error(`Nie można edytować draftu w statusie: ${existing.status}`);
  }

  // Prevent overwriting system fields
  const { id: _id, createdAt: _ca, ...safePatch } = patch;

  const updated: DraftInvoice = {
    ...existing,
    ...safePatch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
    status: "draft", // reset validation on edit
  };

  const withTotals = computeTotals(updated);
  drafts[idx] = withTotals;
  saveDrafts(drafts);
  log("info", `Draft updated: ${id}`);
  return withTotals;
}

export function deleteDraft(id: string): void {
  const drafts = loadDrafts();
  const idx = drafts.findIndex((d) => d.id === id);
  if (idx === -1) throw new Error(`Draft nie znaleziony: ${id}`);

  const existing = drafts[idx];
  if (existing.status !== "draft" && existing.status !== "error") {
    throw new Error(`Można usunąć draft tylko w statusie draft lub error. Aktualny: ${existing.status}`);
  }

  drafts.splice(idx, 1);
  saveDrafts(drafts);
  log("info", `Draft deleted: ${id}`);
}

export function setDraftStatus(
  id: string,
  status: DraftInvoice["status"],
  extras?: Partial<Pick<DraftInvoice, "ksefReferenceNumber" | "sentAt" | "errorMessage">>,
): DraftInvoice {
  const drafts = loadDrafts();
  const idx = drafts.findIndex((d) => d.id === id);
  if (idx === -1) throw new Error(`Draft nie znaleziony: ${id}`);

  drafts[idx] = {
    ...drafts[idx],
    status,
    updatedAt: new Date().toISOString(),
    ...(extras ?? {}),
  };

  saveDrafts(drafts);
  log("info", `Draft status changed to ${status}: ${id}`);
  return drafts[idx];
}

export function lockDraft(id: string, xmlHash: string): DraftInvoice {
  const drafts = loadDrafts();
  const idx = drafts.findIndex((d) => d.id === id);
  if (idx === -1) throw new Error(`Draft nie znaleziony: ${id}`);

  const existing = drafts[idx];
  if (existing.status !== "validated") {
    throw new Error(`Można zablokować tylko zwalidowany draft. Aktualny status: ${existing.status}`);
  }

  const locked: DraftInvoice = {
    ...existing,
    status: "locked",
    xmlHash,
    lockedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  drafts[idx] = locked;
  saveDrafts(drafts);
  log("info", `Draft locked: ${id}`);
  return locked;
}
