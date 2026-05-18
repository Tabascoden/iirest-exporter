import { describe, expect, it } from "vitest";
import { formatNormalizedPriceForCsv, parseNormalizedPrice } from "./price";

describe("price parsing", () => {
  it("parses Russian formatted prices", () => {
    expect(parseNormalizedPrice("1 234,50 ₽")).toBe(1234.5);
    expect(parseNormalizedPrice("123 руб.")).toBe(123);
    expect(parseNormalizedPrice("89.90")).toBe(89.9);
  });

  it("formats normalized prices for CSV", () => {
    expect(formatNormalizedPriceForCsv(1234.5, "1 234,50 ₽")).toBe("1234.50");
    expect(formatNormalizedPriceForCsv(123, "123 руб.")).toBe("123");
    expect(formatNormalizedPriceForCsv(89.9, "89.90")).toBe("89.90");
  });
});
