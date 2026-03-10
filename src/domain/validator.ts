import type { DraftInvoice } from "./draft.js";
import { computeTotals } from "./draft.js";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ─── NIP validation ─────────────────────────────────────────────────────────────

const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];

function isValidNip(nip: string): boolean {
  if (!/^\d{10}$/.test(nip)) return false;
  const digits = nip.split("").map(Number);
  const checksum = NIP_WEIGHTS.reduce((sum, w, i) => sum + w * digits[i], 0) % 11;
  return checksum === digits[9];
}

// ─── Date validation ────────────────────────────────────────────────────────────

function isValidDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(dateStr + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().startsWith(dateStr);
}

// ─── Valid VAT rates ────────────────────────────────────────────────────────────

const VALID_VAT_RATES = [23, 22, 8, 7, 5, 4, 3, 0, -1]; // -1 = "zw" (exempt)

// ─── Validator ──────────────────────────────────────────────────────────────────

export function validateDraft(draft: DraftInvoice): ValidationResult {
  const errors: string[] = [];

  // Seller NIP
  if (!draft.sellerNip) {
    errors.push("Brak NIP sprzedawcy (sellerNip).");
  } else if (!isValidNip(draft.sellerNip)) {
    errors.push(`Nieprawidłowy NIP sprzedawcy: ${draft.sellerNip}. NIP musi mieć 10 cyfr i poprawną sumę kontrolną.`);
  }

  // Seller name
  if (!draft.sellerName || draft.sellerName.trim() === "") {
    errors.push("Brak nazwy sprzedawcy (sellerName).");
  }

  // Buyer NIP — can be foreign (not 10 digits), but must be present
  if (!draft.buyerNip) {
    errors.push("Brak NIP nabywcy (buyerNip).");
  } else if (/^\d{10}$/.test(draft.buyerNip) && !isValidNip(draft.buyerNip)) {
    // Only validate checksum for Polish 10-digit NIPs
    errors.push(`Nieprawidłowy NIP nabywcy: ${draft.buyerNip}. Suma kontrolna nie zgadza się.`);
  }

  // Buyer name
  if (!draft.buyerName || draft.buyerName.trim() === "") {
    errors.push("Brak nazwy nabywcy (buyerName).");
  }

  // Invoice number
  if (!draft.invoiceNumber || draft.invoiceNumber.trim() === "") {
    errors.push("Brak numeru faktury (invoiceNumber).");
  }

  // Issue date
  if (!draft.issueDate) {
    errors.push("Brak daty wystawienia (issueDate).");
  } else if (!isValidDate(draft.issueDate)) {
    errors.push(`Nieprawidłowa data wystawienia: ${draft.issueDate}. Wymagany format: YYYY-MM-DD.`);
  }

  // Sell date (optional, but must be valid if present)
  if (draft.sellDate && !isValidDate(draft.sellDate)) {
    errors.push(`Nieprawidłowa data sprzedaży: ${draft.sellDate}. Wymagany format: YYYY-MM-DD.`);
  }

  // Items
  if (!draft.items || draft.items.length === 0) {
    errors.push("Faktura musi mieć co najmniej jedną pozycję (items).");
  } else {
    draft.items.forEach((item, i) => {
      const pos = i + 1;
      if (!item.name || item.name.trim() === "") {
        errors.push(`Pozycja ${pos}: brak nazwy (name).`);
      }
      if (typeof item.quantity !== "number") {
        errors.push(`Pozycja ${pos}: ilość (quantity) musi być liczbą.`);
      } else if (item.quantity < 0) {
        errors.push(`Pozycja ${pos}: ilość (quantity) nie może być ujemna.`);
      } else if (item.quantity === 0 && !draft.correctionReason) {
        errors.push(`Pozycja ${pos}: ilość (quantity) musi być > 0 (zerowa ilość dozwolona tylko w korekcie).`);
      }
      if (typeof item.unitPrice !== "number" || item.unitPrice < 0) {
        errors.push(`Pozycja ${pos}: cena jednostkowa (unitPrice) musi być >= 0.`);
      }
      if (!VALID_VAT_RATES.includes(item.vatRate)) {
        errors.push(`Pozycja ${pos}: nieprawidłowa stawka VAT: ${item.vatRate}. Dozwolone: ${VALID_VAT_RATES.join(", ")}.`);
      }
    });
  }

  // Totals consistency (only if items are present and computed)
  if (draft.items && draft.items.length > 0) {
    const computed = computeTotals(draft);
    if (
      draft.totalNet !== undefined &&
      draft.totalGross !== undefined &&
      computed.totalGross !== undefined
    ) {
      const diff = Math.abs((draft.totalGross ?? 0) - (computed.totalGross ?? 0));
      if (diff > 0.01) {
        errors.push(
          `Kwota brutto (${draft.totalGross}) nie zgadza się z obliczoną (${computed.totalGross}).`,
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
