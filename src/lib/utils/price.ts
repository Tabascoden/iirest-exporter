export const priceRegex =
  /(?:₽|руб\.?|р\.?)?\s*\d{1,3}(?:[\s\u00A0]?\d{3})*(?:[.,]\d{1,2})?\s*(?:₽|руб\.?|р\.?)?/iu;

const priceWithCurrencyRegexes = [
  /(?:цена|стоимость)\s*:?\s*((?:₽|руб\.?|р\.?)?\s*\d{1,3}(?:[\s\u00A0]?\d{3})*(?:[.,]\d{1,2})?\s*(?:₽|руб\.?|р\.?))/iu,
  /((?:₽|руб\.?|р\.?)\s*\d{1,3}(?:[\s\u00A0]?\d{3})*(?:[.,]\d{1,2})?)/iu,
  /(\d{1,3}(?:[\s\u00A0]?\d{3})*(?:[.,]\d{1,2})?\s*(?:₽|руб\.?|р\.?))/iu,
  /(\d+(?:[.,]\d{1,2}))/iu
];

export function cleanPriceText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function extractPrice(text: string): string {
  const normalized = cleanPriceText(text);
  for (const regex of priceWithCurrencyRegexes) {
    const match = normalized.match(regex);
    if (match?.[1]) {
      return cleanPriceText(match[1]);
    }
  }

  const fallback = normalized.match(priceRegex);
  return fallback?.[0] ? cleanPriceText(fallback[0]) : "";
}

export function parseNormalizedPrice(value: string): number | null {
  const normalized = cleanPriceText(value).replace(/\u00A0/gu, " ");
  const match = normalized.match(
    /\d{1,3}(?:\s\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/u
  );

  if (!match?.[0]) {
    return null;
  }

  const numeric = match[0].replace(/\s/gu, "").replace(",", ".");
  const parsed = Number.parseFloat(numeric);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatNormalizedPriceForCsv(
  normalizedPrice: number | null | undefined,
  sourcePrice: string
): string {
  if (normalizedPrice == null || !Number.isFinite(normalizedPrice)) {
    return sourcePrice;
  }

  const decimalMatch = sourcePrice.match(/[.,](\d{1,2})/u);
  if (!decimalMatch?.[1]) {
    return String(normalizedPrice);
  }

  return normalizedPrice.toFixed(decimalMatch[1].length);
}
