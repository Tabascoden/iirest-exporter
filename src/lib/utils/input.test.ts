import { describe, expect, it } from "vitest";
import { normalizeInputItems } from "./input";

describe("input normalization", () => {
  it("trims lines, ignores blanks, collapses spaces and removes duplicates in order", () => {
    expect(normalizeInputItems("  Молоко  3.2\n\nСыр\nМолоко 3.2\n  Кефир  ")).toEqual([
      "Молоко 3.2",
      "Сыр",
      "Кефир"
    ]);
  });
});
