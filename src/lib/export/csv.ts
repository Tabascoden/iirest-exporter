import type { SupplierSearchResult } from "../suppliers/types";
import { formatNormalizedPriceForCsv } from "../utils/price";

const DELIMITER = ";";
const BOM = "\uFEFF";

const TECHNICAL_HEADERS = [
  "Поставщик",
  "Исходный запрос",
  "Наименование",
  "Единица измерения",
  "Цена"
];

const BASIC_HEADERS = ["Наименование", "Единица измерения", "Цена"];

export interface CsvBuildOptions {
  includeTechnicalColumns: boolean;
}

export function buildSupplierCsv(
  results: SupplierSearchResult[],
  options: CsvBuildOptions = { includeTechnicalColumns: true }
): string {
  const headers = options.includeTechnicalColumns ? TECHNICAL_HEADERS : BASIC_HEADERS;
  const rows = results.map((result) => {
    const price = formatNormalizedPriceForCsv(result.normalizedPrice, result.price);
    if (!options.includeTechnicalColumns) {
      return [result.name, result.unitOrPackage, price];
    }

    return [
      result.supplierName,
      result.sourceQuery,
      result.name,
      result.unitOrPackage,
      price
    ];
  });

  return BOM + [headers, ...rows].map((row) => row.map(escapeCsvValue).join(DELIMITER)).join("\r\n");
}

export function escapeCsvValue(value: unknown): string {
  let text = value == null ? "" : String(value);

  if (/^[=+\-@]/u.test(text.trimStart())) {
    text = `'${text}`;
  }

  text = text.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n");
  const escaped = text.replace(/"/gu, '""');

  if (/[;"\n]/u.test(escaped)) {
    return `"${escaped}"`;
  }

  return escaped;
}

function formatDateForFilename(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());

  return `${year}-${month}-${day}`;
}

export function buildSupplierCsvFilename(supplierName: string, date = new Date()): string {
  const safeSupplierName = supplierName
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return `${formatDateForFilename(date)}-${safeSupplierName || "supplier"}.csv`;
}
