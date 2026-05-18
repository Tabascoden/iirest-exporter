import { afterEach, describe, expect, it, vi } from "vitest";
import { IirestImportError, importPricesToIirest, normalizeIirestBaseUrl } from "./import";

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
});
