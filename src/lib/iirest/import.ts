import type { SupplierSearchResult } from "../suppliers/types";

export type IirestImportMode = "append" | "replace";

export interface IirestImportSupplierSummary {
  provider: string;
  supplier_id: number;
  supplier_name: string;
  created: boolean;
  imported: number;
  file_id: number;
}

export interface IirestImportResponse {
  status: "ok";
  mode: IirestImportMode;
  imported: number;
  skipped: number;
  suppliers: IirestImportSupplierSummary[];
}

export class IirestImportError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "IirestImportError";
    this.status = status;
  }
}

export async function importPricesToIirest(
  baseUrl: string,
  mode: IirestImportMode,
  results: SupplierSearchResult[]
): Promise<IirestImportResponse> {
  const endpoint = `${normalizeIirestBaseUrl(baseUrl)}/api/extension/prices/import`;
  const response = await fetch(endpoint, {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest"
    },
    body: JSON.stringify({ mode, results })
  });
  const payload = await readJsonResponse(response);

  if (!response.ok) {
    if (response.status === 401) {
      throw new IirestImportError("Нужно войти в iiRest.", response.status);
    }
    throw new IirestImportError(readImportErrorMessage(payload, response.status), response.status);
  }

  if (!payload || typeof payload !== "object" || (payload as { status?: unknown }).status !== "ok") {
    throw new Error("iiRest вернул неожиданный ответ.");
  }

  return payload as IirestImportResponse;
}

function readImportErrorMessage(payload: unknown, status: number): string {
  return (
    readPayloadString(payload, "message") ||
    readPayloadString(payload, "error") ||
    `iiRest вернул HTTP ${status}.`
  );
}

export function normalizeIirestBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/u, "");
  const withScheme = /^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  return url.origin;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function readPayloadString(payload: unknown, key: string): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}
