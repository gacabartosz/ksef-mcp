import { XMLBuilder } from "fast-xml-parser";
import type { DraftInvoice } from "./draft.js";
import { computeTotals } from "./draft.js";

// ─── Constants ──────────────────────────────────────────────────────────────────

const FA3_NAMESPACE = "http://crd.gov.pl/wzor/2023/06/29/12648/";

// ─── VAT rate grouping ──────────────────────────────────────────────────────────

interface VatGroup {
  rate: number;
  totalNet: number;
  totalVat: number;
}

function groupByVatRate(draft: DraftInvoice): VatGroup[] {
  const groups = new Map<number, VatGroup>();

  for (const item of draft.items) {
    const rate = item.vatRate;
    const existing = groups.get(rate) || { rate, totalNet: 0, totalVat: 0 };
    existing.totalNet = round2(existing.totalNet + (item.netAmount ?? 0));
    existing.totalVat = round2(existing.totalVat + (item.vatAmount ?? 0));
    groups.set(rate, existing);
  }

  return Array.from(groups.values());
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── VAT rate → P_13/P_14 field mapping (FA(3) schema) ─────────────────────────
// P_13_1/P_14_1 → 23%, P_13_2/P_14_2 → 22%, P_13_3/P_14_3 → 8% etc.

function getVatFieldSuffix(rate: number): string | null {
  const mapping: Record<number, string> = {
    23: "1",
    22: "2",
    8: "3",
    7: "4",
    5: "5",
    4: "6",
    3: "7",
    0: "8",    // 0% (stawka 0)
    // -1 (zw) has a separate field P_13_10 / no P_14
  };
  if (rate === -1) return "10"; // exempt ("zw")
  return mapping[rate] ?? null;
}

// ─── Parse address into components ──────────────────────────────────────────────

function parseAddress(address?: string): Record<string, string> {
  if (!address) return {};
  // Simple approach: use address as AdresL1 (one-line address)
  return { AdresL1: address };
}

// ─── XML Builder ────────────────────────────────────────────────────────────────

export function buildInvoiceXml(draft: DraftInvoice): string {
  const computed = computeTotals(draft);
  const vatGroups = groupByVatRate(computed);

  // Build line items (FaWiersz)
  const faWiersz = computed.items.map((item, idx) => {
    const row: Record<string, unknown> = {
      NrWierszaFa: idx + 1,
      P_7: item.name,
      P_8A: item.unit || "szt.",
      P_8B: item.quantity,
      P_9A: item.unitPrice,
      P_11: item.netAmount,
    };

    if (item.vatRate >= 0) {
      row.P_12 = item.vatRate;
    } else {
      row.P_12 = "zw";
    }

    return row;
  });

  // Build VAT summary fields (P_13_x, P_14_x)
  const vatSummary: Record<string, number> = {};
  for (const group of vatGroups) {
    const suffix = getVatFieldSuffix(group.rate);
    if (suffix) {
      vatSummary[`P_13_${suffix}`] = group.totalNet;
      if (group.rate > 0) {
        vatSummary[`P_14_${suffix}`] = group.totalVat;
      }
    }
  }

  // Build FA section
  const faSection: Record<string, unknown> = {
    KodWaluty: computed.currency || "PLN",
    P_1: computed.issueDate,
    P_2: computed.invoiceNumber,
  };

  if (computed.sellDate) {
    faSection.P_6 = computed.sellDate;
  }

  // Add line items
  faSection.FaWiersz = faWiersz;

  // Add VAT summary fields
  Object.assign(faSection, vatSummary);

  // Add gross total
  faSection.P_15 = computed.totalGross;

  // Build seller address
  const sellerAddress = parseAddress(computed.sellerAddress);
  const buyerAddress = parseAddress(computed.buyerAddress);

  // Build full document structure
  const invoiceObj = {
    "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
    Faktura: {
      "@_xmlns": FA3_NAMESPACE,
      Naglowek: {
        KodFormularza: {
          "#text": "FA",
          "@_kodSystemowy": "FA (3)",
          "@_wersjaSchemy": "1-1E",
        },
        WariantFormularza: 3,
        DataWytworzeniaFa: new Date().toISOString().replace(/\.\d{3}Z$/, ""),
        SystemInfo: "ksef-mcp",
      },
      Podmiot1: {
        DaneIdentyfikacyjne: {
          NIP: computed.sellerNip,
          Nazwa: computed.sellerName,
        },
        Adres: {
          KodKraju: "PL",
          ...sellerAddress,
        },
      },
      Podmiot2: {
        DaneIdentyfikacyjne: {
          NIP: computed.buyerNip,
          Nazwa: computed.buyerName,
        },
        Adres: {
          KodKraju: "PL",
          ...buyerAddress,
        },
      },
      Fa: faSection,
    },
  };

  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    format: true,
    indentBy: "  ",
    suppressEmptyNode: false,
    processEntities: true,
  });

  return builder.build(invoiceObj) as string;
}
