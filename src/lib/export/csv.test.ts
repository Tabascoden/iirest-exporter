import { describe, expect, it } from "vitest";
import { buildSupplierCsv, buildSupplierCsvFilename, escapeCsvValue } from "./csv";
import type { SupplierSearchResult } from "../suppliers/types";

const result: SupplierSearchResult = {
  supplierId: "gfc",
  supplierName: "GFC Russia",
  sourceQuery: "молоко",
  name: 'Молоко "Ферма"; 3,2%',
  unitOrPackage: "1 л",
  price: "1 234,50 ₽",
  normalizedPrice: 1234.5,
  url: "https://gfc-russia.ru/product/1",
  scrapedAt: "2026-05-08T12:00:00.000Z"
};

describe("CSV export", () => {
  it("adds UTF-8 BOM and semicolon-separated headers", () => {
    const csv = buildSupplierCsv([result], { includeTechnicalColumns: true });
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("Поставщик;Исходный запрос;Наименование");
    expect(csv).not.toContain("URL товара");
    expect(csv).not.toContain("Дата и время сбора");
    expect(csv).not.toContain("https://gfc-russia.ru/product/1");
    expect(csv).not.toContain("2026-05-08T12:00:00.000Z");
  });

  it("escapes quotes, semicolons and line breaks", () => {
    expect(escapeCsvValue('a"b;c\nd')).toBe('"a""b;c\nd"');
  });

  it("protects against formula injection", () => {
    expect(escapeCsvValue("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(escapeCsvValue("+1")).toBe("'+1");
    expect(escapeCsvValue("-1")).toBe("'-1");
    expect(escapeCsvValue("@cmd")).toBe("'@cmd");
  });

  it("can export only business columns", () => {
    const csv = buildSupplierCsv([result], { includeTechnicalColumns: false });
    expect(csv).toContain("Наименование;Единица измерения;Цена");
    expect(csv).not.toContain("GFC Russia;молоко");
  });

  it("adds supplier name to supplier-scoped filenames", () => {
    const filename = buildSupplierCsvFilename("GFC Russia", new Date(2026, 4, 8, 18, 30));
    expect(filename).toBe("2026-05-08-gfc-russia.csv");
  });
});
