import { describe, expect, it } from "vitest";
import { parsePurchaseFile, parsePurchaseRows } from "./file";

describe("parsePurchaseRows", () => {
  it("detects name, quantity and price headers", () => {
    const result = parsePurchaseRows([
      ["Name", "Qty", "Price"],
      ["Milk 3.2", "2", "120.50"],
      ["Cheese 500 g", "1,5 kg", "274 rub"]
    ]);

    expect(result.items).toEqual([
      { name: "Milk 3.2", quantity: "2", price: "120.5", rowNumber: 2 },
      { name: "Cheese 500 g", quantity: "1.5", price: "274", rowNumber: 3 }
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("requires a price for every purchase item", () => {
    const result = parsePurchaseRows([
      ["Name", "Qty"],
      ["Beef", 3],
      ["Salt", ""]
    ]);

    expect(result.items).toEqual([]);
    expect(result.warnings).toContain("Колонка цены не найдена. Без совпадения цены товары в корзину не добавляются.");
    expect(result.warnings).toContain('Строка 2: "Beef" пропущен, нет цены для проверки совпадения.');
    expect(result.warnings).toContain('Строка 3: "Salt" пропущен, нет количества.');
  });

  it("falls back to the first three columns without headers", () => {
    const result = parsePurchaseRows([["Beef", 3, "950"]]);

    expect(result.items).toEqual([{ name: "Beef", quantity: "3", price: "950", rowNumber: 1 }]);
    expect(result.warnings).toContain("Заголовки не найдены, использую первые три колонки: товар, количество и цена.");
  });

  it("parses semicolon CSV files", async () => {
    const file = new File(["Name;Qty;Price\nKefir;4;89.90\n"], "purchase.csv", {
      type: "text/csv"
    });

    const result = await parsePurchaseFile(file);

    expect(result.items).toEqual([{ name: "Kefir", quantity: "4", price: "89.9", rowNumber: 2 }]);
  });
});
