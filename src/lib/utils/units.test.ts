import { describe, expect, it } from "vitest";
import { extractUnitFromPrice, extractUnitOrPackage } from "./units";

describe("unit parsing", () => {
  it("extracts common units and package markers", () => {
    expect(extractUnitOrPackage("Молоко 3,2% 1 л")).toBe("1 л");
    expect(extractUnitOrPackage("Сыр 500 г")).toBe("500 г");
    expect(["250 мл", "50 шт"]).toContain(extractUnitOrPackage("Стакан бумажный 250 мл 50 шт"));
  });

  it("extracts multiplied package formats", () => {
    expect(extractUnitOrPackage("Товар 1 кг x 10")).toBe("1 кг x 10");
    expect(extractUnitOrPackage("Товар 10 х 500 г")).toBe("10 х 500 г");
    expect(extractUnitOrPackage("Упаковка уп.")).toBe("уп.");
  });

  it("extracts the sold unit from price text", () => {
    expect(extractUnitFromPrice("1 152₽/кг")).toBe("кг");
    expect(extractUnitFromPrice("274 ₽/шт")).toBe("шт");
    expect(extractUnitFromPrice("1 239 ₽/кг -7 % 1 152₽/кг")).toBe("кг");
  });
});
