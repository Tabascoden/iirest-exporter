export type SupplierId = "gfc" | "smartpro" | "metro";

export interface SupplierSearchResult {
  supplierId: SupplierId;
  supplierName: string;
  sourceQuery: string;
  name: string;
  unitOrPackage: string;
  price: string;
  normalizedPrice?: number | null;
  url?: string;
  scrapedAt: string;
}

export interface PurchaseUploadItem {
  name: string;
  quantity: string;
  price: string;
  rowNumber: number;
}

export interface SupplierCartResult {
  supplierId: SupplierId;
  supplierName: string;
  sourceName: string;
  requestedQuantity: string;
  requestedPrice: string;
  matchedName?: string;
  matchedPrice?: string;
  status: "added" | "not_found" | "error";
  message?: string;
  url?: string;
  completedAt: string;
}

export interface SupplierAdapter {
  id: SupplierId;
  name: string;
  startUrl: string;
  loginUrl?: string;

  detectLoginState(): Promise<{
    loggedIn: boolean;
    reason?: string;
  }>;

  search(
    query: string,
    options: {
      signal?: AbortSignal;
      maxPages?: number;
      delayMs?: number;
    }
  ): Promise<SupplierSearchResult[]>;

  addToCart(
    item: PurchaseUploadItem,
    options: {
      signal?: AbortSignal;
      delayMs?: number;
      maxPages?: number;
    }
  ): Promise<SupplierCartResult>;
}

export interface SupplierInfo {
  id: SupplierId;
  name: string;
  startUrl: string;
  loginUrl?: string;
  hostPatterns: string[];
  searchPathPrefix?: string;
  searchUrl?: (query: string) => string;
}

export const SUPPLIERS: Record<SupplierId, SupplierInfo> = {
  gfc: {
    id: "gfc",
    name: "GFC Russia",
    startUrl: "https://gfc-russia.ru/",
    hostPatterns: ["gfc-russia.ru"]
  },
  smartpro: {
    id: "smartpro",
    name: "SmartPro",
    startUrl: "https://smartpro.ru/marketplace/",
    loginUrl: "https://smartpro.ru/login/",
    hostPatterns: ["smartpro.ru"],
    searchPathPrefix: "/marketplace"
  },
  metro: {
    id: "metro",
    name: "METRO",
    startUrl: "https://online.metro-cc.ru/",
    loginUrl: "https://online.metro-cc.ru/login",
    hostPatterns: ["online.metro-cc.ru"],
    searchPathPrefix: "/search",
    searchUrl: (query) => `https://online.metro-cc.ru/search?q=${encodeURIComponent(query)}`
  }
};

export const SUPPLIER_IDS = Object.keys(SUPPLIERS) as SupplierId[];
