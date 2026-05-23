import type { SupplierAdapter, SupplierId } from "./types";
import { gfcAdapter } from "./gfc.adapter";
import { metroAdapter } from "./metro.adapter";
import { smartproAdapter } from "./smartpro.adapter";
import { sweetlifeAdapter } from "./sweetlife.adapter";

export const supplierRegistry: Record<SupplierId, SupplierAdapter> = {
  gfc: gfcAdapter,
  smartpro: smartproAdapter,
  metro: metroAdapter,
  sweetlife: sweetlifeAdapter
};

export function getSupplierAdapter(id: SupplierId): SupplierAdapter {
  return supplierRegistry[id];
}
