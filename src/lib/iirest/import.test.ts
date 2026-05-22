import { afterEach, describe, expect, it, vi } from "vitest";
import { IirestImportError, importPricesToIirest, normalizeIirestBaseUrl } from "./import";
import type { SupplierSearchResult } from "../suppliers/types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeIirestBaseUrl", () => {
  it("keeps explicit https urls", () => {
    expect(normalizeIirestBaseUrl("https://app.iirest.ru/")).toBe("https://app.iirest.ru");
  });

  it("adds https scheme for host-only input", () => {
    expect(normalizeIirestBaseUrl("app.iirest.ru")).toBe("https://app.iirest.ru");
  });

  it("keeps local http urls", () => {
    expect(normalizeIirestBaseUrl("http://localhost:5000/")).toBe("http://localhost:5000");
  });

  it("strips page paths from pasted iiRest urls", () => {
    expect(normalizeIirestBaseUrl("https://app.iirest.ru/orders/current?tab=prices")).toBe("https://app.iirest.ru");
  });

  it("throws a typed auth error for 401 responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "auth_required" }), { status: 401 })
    );

    await expect(importPricesToIirest("https://app.iirest.ru", "append", [])).rejects.toMatchObject({
      name: "IirestImportError",
      status: 401,
      message: "Нужно войти в iiRest."
    } satisfies Partial<IirestImportError>);
  });

  it("posts JSON results with browser credentials", async () => {
    const result: SupplierSearchResult = {
      supplierId: "gfc",
      supplierName: "GFC Russia",
      sourceQuery: "молоко",
      name: "Молоко",
      unitOrPackage: "1 л",
      price: "120 ₽",
      normalizedPrice: 120,
      url: "https://gfc-russia.ru/product/1",
      scrapedAt: "2026-05-22T10:00:00.000Z"
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          mode: "append",
          imported: 1,
          skipped: 0,
          suppliers: []
        }),
        { status: 200 }
      )
    );

    await importPricesToIirest("https://app.iirest.ru/", "append", [result]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://app.iirest.ru/api/extension/prices/import",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: JSON.stringify({ mode: "append", results: [result] })
      })
    );
  });
});
