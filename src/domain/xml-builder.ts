import { XMLBuilder } from "fast-xml-parser";
import type { DraftInvoice, InvoiceItem } from "./draft.js";
import { computeTotals } from "./draft.js";

// ─── HTML entity decoding ────────────────────────────────────────────────────────

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function sanitizeDraftStrings(draft: DraftInvoice): DraftInvoice {
  return {
    ...draft,
    sellerName: decodeHtmlEntities(draft.sellerName),
    sellerAddress: draft.sellerAddress ? decodeHtmlEntities(draft.sellerAddress) : draft.sellerAddress,
    buyerName: decodeHtmlEntities(draft.buyerName),
    buyerAddress: draft.buyerAddress ? decodeHtmlEntities(draft.buyerAddress) : draft.buyerAddress,
    invoiceNumber: decodeHtmlEntities(draft.invoiceNumber),
    originalInvoiceNumber: draft.originalInvoiceNumber ? decodeHtmlEntities(draft.originalInvoiceNumber) : draft.originalInvoiceNumber,
    items: draft.items.map((item) => ({
      ...item,
      name: decodeHtmlEntities(item.name),
    })),
    originalItems: draft.originalItems?.map((item) => ({
      ...item,
      name: decodeHtmlEntities(item.name),
    })),
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const FA3_NAMESPACE = "http://crd.gov.pl/wzor/2025/06/25/13775/";

// ─── VAT rate grouping ──────────────────────────────────────────────────────────

interface VatGroup {
  rate: number;
  totalNet: number;
  totalVat: number;
}

function groupByVatRate(items: InvoiceItem[]): VatGroup[] {
  const groups = new Map<number, VatGroup>();

  for (const item of items) {
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

// ─── Compute items with amounts ─────────────────────────────────────────────────

function computeItemAmounts(items: InvoiceItem[]): InvoiceItem[] {
  return items.map((item) => {
    const netAmount = round2(item.quantity * item.unitPrice);
    const vatAmount = item.vatRate >= 0
      ? round2(netAmount * item.vatRate / 100)
      : 0;
    const grossAmount = round2(netAmount + vatAmount);
    return { ...item, netAmount, vatAmount, grossAmount };
  });
}

// ─── Build VAT summary fields ───────────────────────────────────────────────────

function buildVatSummary(vatGroups: VatGroup[], exchangeRate?: number): Record<string, number> {
  const vatSummary: Record<string, number> = {};
  for (const group of vatGroups) {
    const suffix = getVatFieldSuffix(group.rate);
    if (suffix) {
      vatSummary[`P_13_${suffix}`] = group.totalNet;
      if (group.rate > 0) {
        vatSummary[`P_14_${suffix}`] = group.totalVat;
        // P_14_xW — VAT in PLN for foreign currency invoices
        if (exchangeRate) {
          vatSummary[`P_14_${suffix}W`] = round2(group.totalVat * exchangeRate);
        }
      }
    }
  }
  return vatSummary;
}

// ─── Adnotacje section (standard for all invoices) ──────────────────────────────

function buildAdnotacje(): Record<string, unknown> {
  return {
    P_16: 2,
    P_17: 2,
    P_18: 2,
    P_18A: 2,
    Zwolnienie: { P_19N: 1 },
    NoweSrodkiTransportu: { P_22N: 1 },
    P_23: 2,
    PMarzy: { P_PMarzyN: 1 },
  };
}

// ─── XML Builder ────────────────────────────────────────────────────────────────

export function buildInvoiceXml(draft: DraftInvoice): string {
  const computed = computeTotals(sanitizeDraftStrings(draft));
  const isCorrection = !!computed.correctionReason;

  // Build seller/buyer addresses
  const sellerAddress = parseAddress(computed.sellerAddress);
  const buyerAddress = parseAddress(computed.buyerAddress);

  // Build FA section with correct element order
  const faSection: Record<string, unknown> = {};

  // 1. KodWaluty
  faSection.KodWaluty = computed.currency || "PLN";

  // 2. P_1 (issue date)
  faSection.P_1 = computed.issueDate;

  // 3. P_2 (invoice number)
  faSection.P_2 = computed.invoiceNumber;

  // 4. P_6 (sell date)
  if (computed.sellDate) {
    faSection.P_6 = computed.sellDate;
  }

  // 5. P_13_x, P_14_x (VAT summary per rate)
  if (isCorrection && computed.originalItems) {
    // Correction: compute difference (after - before)
    const beforeItems = computeItemAmounts(computed.originalItems);
    const afterItems = computed.items; // already computed by computeTotals

    const beforeGroups = groupByVatRate(beforeItems);
    const afterGroups = groupByVatRate(afterItems);

    // Collect all rates
    const allRates = new Set<number>();
    beforeGroups.forEach((g) => allRates.add(g.rate));
    afterGroups.forEach((g) => allRates.add(g.rate));

    for (const rate of allRates) {
      const suffix = getVatFieldSuffix(rate);
      if (!suffix) continue;

      const beforeGroup = beforeGroups.find((g) => g.rate === rate);
      const afterGroup = afterGroups.find((g) => g.rate === rate);

      const diffNet = round2((afterGroup?.totalNet ?? 0) - (beforeGroup?.totalNet ?? 0));
      faSection[`P_13_${suffix}`] = diffNet;

      if (rate > 0) {
        const diffVat = round2((afterGroup?.totalVat ?? 0) - (beforeGroup?.totalVat ?? 0));
        faSection[`P_14_${suffix}`] = diffVat;
        // P_14_xW — VAT difference in PLN for foreign currency invoices
        if (computed.forcedVatPln?.[suffix] !== undefined) {
          // Manual override (e.g. KOR-to-KOR where only P_14_xW changes)
          faSection[`P_14_${suffix}W`] = computed.forcedVatPln[suffix];
        } else if (computed.exchangeRate) {
          faSection[`P_14_${suffix}W`] = round2(diffVat * computed.exchangeRate);
        }
      }
    }

    // P_15 (gross total as difference)
    const beforeGross = round2(
      beforeItems.reduce((s, i) => s + (i.grossAmount ?? 0), 0),
    );
    const afterGross = computed.totalGross ?? 0;
    faSection.P_15 = round2(afterGross - beforeGross);
  } else {
    // Standard invoice: use computed totals
    const vatGroups = groupByVatRate(computed.items);
    const isForeignCurrency = computed.currency && computed.currency !== "PLN";
    Object.assign(faSection, buildVatSummary(vatGroups, isForeignCurrency ? computed.exchangeRate : undefined));

    // 6. P_15 (gross total)
    faSection.P_15 = computed.totalGross;
  }

  // 7. Adnotacje
  faSection.Adnotacje = buildAdnotacje();

  // 8. RodzajFaktury
  faSection.RodzajFaktury = isCorrection ? "KOR" : "VAT";

  // 9-11. Correction-specific fields
  if (isCorrection) {
    faSection.PrzyczynaKorekty = computed.correctionReason;
    faSection.TypKorekty = 1; // value correction
    faSection.DaneFaKorygowanej = {
      DataWystFaKorygowanej: computed.originalIssueDate,
      NrFaKorygowanej: computed.originalInvoiceNumber,
      NrKSeF: 1, // flag: corrected invoice has KSeF number
      NrKSeFFaKorygowanej: computed.originalKsefRef,
    };
  }

  // 12. FaWiersz entries
  if (isCorrection && computed.originalItems) {
    // Correction: emit before/after pairs
    const beforeItems = computeItemAmounts(computed.originalItems);
    const faWiersz: Record<string, unknown>[] = [];

    for (let i = 0; i < beforeItems.length; i++) {
      const origItem = beforeItems[i];
      const lineNum = i + 1;

      // Before line (StanPrzed = 1)
      faWiersz.push({
        NrWierszaFa: lineNum,
        P_7: origItem.name,
        P_8A: origItem.unit || "szt.",
        P_8B: origItem.quantity,
        P_9A: origItem.unitPrice,
        P_11: origItem.netAmount,
        P_12: origItem.vatRate >= 0 ? origItem.vatRate : "zw",
        StanPrzed: 1,
      });

      // After line (zeroing: qty=0, net=0)
      faWiersz.push({
        NrWierszaFa: lineNum,
        P_7: origItem.name,
        P_8A: origItem.unit || "szt.",
        P_8B: 0,
        P_9A: origItem.unitPrice,
        P_11: 0,
        P_12: origItem.vatRate >= 0 ? origItem.vatRate : "zw",
      });
    }

    faSection.FaWiersz = faWiersz;
  } else {
    // Standard invoice line items
    faSection.FaWiersz = computed.items.map((item, idx) => {
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
  }

  // Build full document structure
  const invoiceObj = {
    "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
    Faktura: {
      "@_xmlns": FA3_NAMESPACE,
      Naglowek: {
        KodFormularza: {
          "#text": "FA",
          "@_kodSystemowy": "FA (3)",
          "@_wersjaSchemy": "1-0E",
        },
        WariantFormularza: 3,
        DataWytworzeniaFa: draft.createdAt.replace(/\.\d{3}Z$/, ""),
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
        JST: 2,
        GV: 2,
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
