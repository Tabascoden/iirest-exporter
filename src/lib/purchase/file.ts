import { strFromU8, unzipSync } from "fflate";
import type { PurchaseUploadItem } from "../suppliers/types";

export interface PurchaseFileParseResult {
  items: PurchaseUploadItem[];
  warnings: string[];
  sheetName?: string;
}

type CellRow = unknown[];

const NAME_HEADER_PATTERN = /(наимен|назван|товар|продукт|позици|item|name|product)/iu;
const QUANTITY_HEADER_PATTERN = /(кол-?во|колич|к-?во|quantity|qty|заказ)/iu;
const PRICE_HEADER_PATTERN = /(цена|стоим|прайс|price|cost|amount)/iu;

export async function parsePurchaseFile(file: File): Promise<PurchaseFileParseResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileName = file.name.toLocaleLowerCase("ru-RU");

  if (fileName.endsWith(".xls") && !fileName.endsWith(".xlsx")) {
    return {
      items: [],
      warnings: ["Старый формат .xls не поддержан. Сохраните файл как .xlsx, .csv или .tsv."]
    };
  }

  if (fileName.endsWith(".csv") || fileName.endsWith(".tsv") || !isZipFile(bytes)) {
    return parseDelimitedFile(bytes, fileName.endsWith(".tsv") ? "\t" : undefined);
  }

  return parseXlsxFile(bytes);
}

export function parsePurchaseRows(rows: CellRow[]): PurchaseFileParseResult {
  const warnings: string[] = [];
  const header = findHeader(rows);
  const nameColumn = header?.nameColumn ?? 0;
  const quantityColumn = header?.quantityColumn ?? 1;
  const priceColumn = header?.priceColumn ?? 2;
  const hasPriceColumn = !header || header.priceColumn >= 0;
  const startRow = header ? header.rowIndex + 1 : 0;
  const items: PurchaseUploadItem[] = [];

  if (!header) {
    warnings.push("Заголовки не найдены, использую первые три колонки: товар, количество и цена.");
  } else if (!hasPriceColumn) {
    warnings.push("Колонка цены не найдена. Без совпадения цены товары в корзину не добавляются.");
  }

  for (let index = startRow; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (isEmptyRow(row)) {
      continue;
    }

    const name = readCell(row[nameColumn]);
    const quantity = normalizeQuantity(row[quantityColumn]);
    const price = hasPriceColumn ? normalizePrice(row[priceColumn]) : "";
    const rowNumber = index + 1;

    if (!name && !quantity && !price) {
      continue;
    }

    if (!name) {
      warnings.push(`Строка ${rowNumber}: пропущена, нет наименования.`);
      continue;
    }

    if (!quantity) {
      warnings.push(`Строка ${rowNumber}: "${name}" пропущен, нет количества.`);
      continue;
    }

    if (!price) {
      warnings.push(`Строка ${rowNumber}: "${name}" пропущен, нет цены для проверки совпадения.`);
      continue;
    }

    items.push({
      name,
      quantity,
      price,
      rowNumber
    });
  }

  return { items, warnings };
}

function parseDelimitedFile(bytes: Uint8Array, fixedDelimiter?: string): PurchaseFileParseResult {
  const text = decodeText(bytes);
  const delimiter = fixedDelimiter ?? detectDelimiter(text);
  return parsePurchaseRows(parseDelimitedRows(text, delimiter));
}

function parseXlsxFile(bytes: Uint8Array): PurchaseFileParseResult {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return {
      items: [],
      warnings: ["Не удалось прочитать .xlsx файл. Проверьте, что файл не поврежден."]
    };
  }

  const sharedStrings = parseSharedStrings(entries["xl/sharedStrings.xml"]);
  const workbook = parseWorkbook(entries);
  const worksheetPath = workbook.sheetPath ?? "xl/worksheets/sheet1.xml";
  const worksheet = entries[worksheetPath];

  if (!worksheet) {
    return {
      items: [],
      warnings: ["В .xlsx файле не найден первый лист."],
      sheetName: workbook.sheetName
    };
  }

  return {
    ...parsePurchaseRows(parseWorksheet(strFromU8(worksheet), sharedStrings)),
    sheetName: workbook.sheetName
  };
}

function parseWorkbook(entries: Record<string, Uint8Array>): { sheetName?: string; sheetPath?: string } {
  const workbookXml = entries["xl/workbook.xml"];
  const relsXml = entries["xl/_rels/workbook.xml.rels"];
  if (!workbookXml) {
    return {};
  }

  const workbook = parseXml(strFromU8(workbookXml));
  const firstSheet = workbook.getElementsByTagName("sheet")[0];
  const sheetName = firstSheet?.getAttribute("name") ?? undefined;
  const relationId = firstSheet?.getAttribute("r:id") ?? firstSheet?.getAttribute("id") ?? undefined;

  if (!relationId || !relsXml) {
    return { sheetName };
  }

  const rels = parseXml(strFromU8(relsXml));
  const relation = Array.from(rels.getElementsByTagName("Relationship")).find(
    (item) => item.getAttribute("Id") === relationId
  );
  const target = relation?.getAttribute("Target");
  if (!target) {
    return { sheetName };
  }

  return {
    sheetName,
    sheetPath: normalizeXlsxPath(target)
  };
}

function parseSharedStrings(bytes: Uint8Array | undefined): string[] {
  if (!bytes) {
    return [];
  }

  const document = parseXml(strFromU8(bytes));
  return Array.from(document.getElementsByTagName("si")).map((item) =>
    Array.from(item.getElementsByTagName("t"))
      .map((textNode) => textNode.textContent ?? "")
      .join("")
  );
}

function parseWorksheet(xml: string, sharedStrings: string[]): CellRow[] {
  const document = parseXml(xml);
  return Array.from(document.getElementsByTagName("row"))
    .map((row) => {
      const values: CellRow = [];
      for (const cell of Array.from(row.getElementsByTagName("c"))) {
        const columnIndex = columnIndexFromCellRef(cell.getAttribute("r") ?? "");
        values[columnIndex] = readXlsxCell(cell, sharedStrings);
      }
      return values;
    })
    .filter((row) => !isEmptyRow(row));
}

function readXlsxCell(cell: Element, sharedStrings: string[]): string {
  const type = cell.getAttribute("t");
  if (type === "inlineStr") {
    return Array.from(cell.getElementsByTagName("t"))
      .map((textNode) => textNode.textContent ?? "")
      .join("");
  }

  const rawValue = cell.getElementsByTagName("v")[0]?.textContent ?? "";
  if (type === "s") {
    return sharedStrings[Number(rawValue)] ?? "";
  }

  return rawValue;
}

function parseDelimitedRows(text: string, delimiter: string): CellRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows.filter((item) => !isEmptyRow(item));
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/u).find((line) => line.trim()) ?? "";
  const delimiters = [";", "\t", ","];
  return delimiters
    .map((delimiter) => ({
      delimiter,
      count: firstLine.split(delimiter).length
    }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter ?? ";";
}

function findHeader(
  rows: CellRow[]
): { rowIndex: number; nameColumn: number; quantityColumn: number; priceColumn: number } | null {
  const limit = Math.min(rows.length, 10);

  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    let nameColumn = -1;
    let quantityColumn = -1;
    let priceColumn = -1;

    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const cell = readCell(row[columnIndex]).toLocaleLowerCase("ru-RU");
      if (nameColumn === -1 && NAME_HEADER_PATTERN.test(cell)) {
        nameColumn = columnIndex;
      }
      if (quantityColumn === -1 && QUANTITY_HEADER_PATTERN.test(cell)) {
        quantityColumn = columnIndex;
      }
      if (priceColumn === -1 && PRICE_HEADER_PATTERN.test(cell)) {
        priceColumn = columnIndex;
      }
    }

    if (nameColumn !== -1 && quantityColumn !== -1 && nameColumn !== quantityColumn) {
      return { rowIndex, nameColumn, quantityColumn, priceColumn };
    }
  }

  return null;
}

function normalizeQuantity(value: unknown): string {
  const text = readCell(value);
  const match = text.match(/\d+(?:[.,]\d+)?/u);
  if (!match) {
    return "";
  }

  const parsed = Number(match[0].replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "";
  }

  return String(parsed);
}

function normalizePrice(value: unknown): string {
  const text = readCell(value);
  const match = text.match(/\d{1,3}(?:[\s\u00A0]?\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?/u);
  if (!match) {
    return "";
  }

  const parsed = Number(match[0].replace(/[\s\u00A0]/gu, "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "";
  }

  return String(parsed);
}

function readCell(value: unknown): string {
  if (value == null) {
    return "";
  }

  return String(value).replace(/\s+/gu, " ").trim();
}

function isEmptyRow(row: CellRow): boolean {
  return row.every((cell) => readCell(cell) === "");
}

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml, "application/xml");
}

function columnIndexFromCellRef(ref: string): number {
  const letters = ref.match(/^[A-Z]+/iu)?.[0] ?? "A";
  return letters
    .toUpperCase()
    .split("")
    .reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function normalizeXlsxPath(target: string): string {
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  const parts: string[] = [];

  for (const part of path.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.join("/");
}

function decodeText(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  const replacementCount = (utf8.match(/\uFFFD/gu) ?? []).length;
  if (replacementCount === 0) {
    return utf8.replace(/^\uFEFF/u, "");
  }

  return new TextDecoder("windows-1251").decode(bytes).replace(/^\uFEFF/u, "");
}

function isZipFile(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}
