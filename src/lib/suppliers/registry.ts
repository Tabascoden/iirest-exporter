import type { SupplierAdapter, SupplierId } from "./types";
import { gfcAdapter } from "./gfc.adapter";
import { metroAdapter } from "./metro.adapter";
import { smartproAdapter } from "./smartpro.adapter";

export const supplierRegistry: Record<SupplierId, SupplierAdapter> = {
  gfc: gfcAdapter,
  smartpro: smartproAdapter,
  metro: metroAdapter
};

export function getSupplierAdapter(id: SupplierId): SupplierAdapter {
  return supplierRegistry[id];
}
