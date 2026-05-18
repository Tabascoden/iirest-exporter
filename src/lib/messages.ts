import type { PurchaseUploadItem, SupplierId, SupplierSearchResult } from "./suppliers/types";
import type { ExtensionSettings } from "./storage/results";

export type RunStatus =
  | "idle"
  | "running"
  | "login_required"
  | "stopped"
  | "completed"
  | "error";

export interface RunProgress {
  status: RunStatus;
  supplierId?: SupplierId;
  supplierName?: string;
  query?: string;
  current: number;
  total: number;
  found: number;
  errors: number;
  message?: string;
  loginRequired?: {
    supplierId: SupplierId;
    supplierName: string;
    tabId?: number;
  };
}

export interface LogEntry {
  id: string;
  at: string;
  level: "info" | "warn" | "error";
  message: string;
  supplierId?: SupplierId;
  query?: string;
}

export interface StartSearchPayload {
  rawInput: string;
  queries: string[];
  selectedSuppliers: SupplierId[];
  settings: ExtensionSettings;
}

export interface PurchaseUploadSupplierFile {
  supplierId: SupplierId;
  fileName: string;
  items: PurchaseUploadItem[];
}

export interface StartPurchaseUploadPayload {
  supplierFiles: PurchaseUploadSupplierFile[];
  settings: ExtensionSettings;
}

export type RuntimeRequest =
  | { type: "START_SEARCH"; payload: StartSearchPayload }
  | { type: "START_PURCHASE_UPLOAD"; payload: StartPurchaseUploadPayload }
  | { type: "STOP_SEARCH" }
  | { type: "CONTINUE_SEARCH" }
  | { type: "CLEAR_RESULTS" }
  | { type: "GET_STATE" }
  | { type: "SAVE_SETTINGS"; payload: ExtensionSettings };

export type RuntimeResponse<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export type RuntimeEvent =
  | { type: "STATE_CHANGED"; payload: { progress: RunProgress; results: SupplierSearchResult[]; logs: LogEntry[] } }
  | { type: "LOG_ADDED"; payload: LogEntry };

export interface DomDiagnostic {
  adapter: string;
  url: string;
  title: string;
  visibilityState?: string;
  hasFocus?: boolean;
  searchInputFound: boolean;
  productRowsFound: number;
  message: string;
}

export interface PageDiagnostic {
  url: string;
  title: string;
  visibilityState: string;
  hasFocus: boolean;
}

export type ContentRequest =
  | { type: "SUPPLIER_PING" }
  | { type: "SUPPLIER_DETECT_LOGIN"; supplierId: SupplierId }
  | {
      type: "SUPPLIER_SEARCH";
      supplierId: SupplierId;
      runId: string;
      query: string;
      options: {
        maxPages?: number;
        delayMs?: number;
      };
    }
  | {
      type: "SUPPLIER_ADD_TO_CART";
      supplierId: SupplierId;
      runId: string;
      item: PurchaseUploadItem;
      options: {
        delayMs?: number;
        maxPages?: number;
      };
    }
  | { type: "SUPPLIER_ABORT"; runId?: string };

export type ContentResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; diagnostic?: DomDiagnostic };
