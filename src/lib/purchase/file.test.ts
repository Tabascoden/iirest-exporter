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

  it("parses iiRest cart export rows", () => {
    const result = parsePurchaseRows([
      [
        "\u041f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a",
        "\u0422\u043e\u0432\u0430\u0440",
        "\u041a\u043e\u043b-\u0432\u043e\n\u0437\u0430\u043a\u0430\u0437\u0430",
        "\u0415\u0434.\n\u0438\u0437\u043c.",
        "\u0426\u0435\u043d\u0430,\n\u0440\u0443\u0431",
        "\u0421\u0443\u043c\u043c\u0430,\n\u0440\u0443\u0431"
      ],
      ["GFC Russia", "Milk 3.2", 2, "pcs", 120.5, 241]
    ]);

    expect(result.items).toEqual([{ name: "Milk 3.2", quantity: "2", price: "120.5", rowNumber: 2 }]);
    expect(result.warnings).toEqual([]);
  });

  it("parses iiRest tender supplier export rows and ignores group totals", () => {
    const result = parsePurchaseRows([
      [
        "\u2116",
        "\u0422\u043e\u0432\u0430\u0440 \u0443\n\u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0430",
        "\u041a\u043e\u043b-\u0432\u043e\n\u0434\u043b\u044f \u0437\u0430\u043a\u0430\u0437\u0430",
        "\u0415\u0434.\n\u0438\u0437\u043c.",
        "\u0426\u0435\u043d\u0430\n\u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0430",
        "\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439\n\u0434\u043b\u044f \u043f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a\u0430",
        "\u0421\u0443\u043c\u043c\u0430,\n\u0440\u0443\u0431"
      ],
      ["\u041f\u043e\u0441\u0442\u0430\u0432\u0449\u0438\u043a: GFC Russia", "", "", "", "", "", ""],
      ["\u041e\u0441\u043d\u043e\u0432\u043d\u043e\u0439 \u0441\u043f\u0438\u0441\u043e\u043a", "", "", "", "", "", ""],
      [7, "Cheese 500 g", "1,5", "kg", "274,00", "", "411,00"],
      ["\u041f\u043e\u0434\u044b\u0442\u043e\u0433", "", "", "", "", "", "411,00"],
      ["\u0418\u0422\u041e\u0413\u041e", "", "", "", "", "", "411,00"]
    ]);

    expect(result.items).toEqual([{ name: "Cheese 500 g", quantity: "1.5", price: "274", rowNumber: 4 }]);
    expect(result.warnings).toEqual([]);
  });
});
