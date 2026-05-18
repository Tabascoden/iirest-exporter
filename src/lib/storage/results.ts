import type { LogEntry, RunProgress } from "../messages";
import type { SupplierId, SupplierSearchResult } from "../suppliers/types";

const STORAGE_KEY = "supplierProductExporterState";

export interface ExtensionSettings {
  selectedSuppliers: SupplierId[];
  includeTechnicalColumns: boolean;
  maxPagesPerQuery: number;
  delayBetweenQueriesMs: number;
  delayBetweenPagesMs: number;
}

export interface ExtensionState {
  results: SupplierSearchResult[];
  lastRunAt?: string;
  lastInputItems: string[];
  settings: ExtensionSettings;
  logs: LogEntry[];
  progress: RunProgress;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  selectedSuppliers: ["gfc", "smartpro", "metro"],
  includeTechnicalColumns: true,
  maxPagesPerQuery: 25,
  delayBetweenQueriesMs: 0,
  delayBetweenPagesMs: 700
};

export const DEFAULT_PROGRESS: RunProgress = {
  status: "idle",
  current: 0,
  total: 0,
  found: 0,
  errors: 0,
  message: "Готово к поиску"
};

export const DEFAULT_STATE: ExtensionState = {
  results: [],
  lastInputItems: [],
  settings: DEFAULT_SETTINGS,
  logs: [],
  progress: DEFAULT_PROGRESS
};

export async function loadExtensionState(): Promise<ExtensionState> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY] as Partial<ExtensionState> | undefined;

  return {
    ...DEFAULT_STATE,
    ...value,
    results: value?.results ?? [],
    lastInputItems: value?.lastInputItems ?? [],
    logs: value?.logs ?? [],
    settings: {
      ...DEFAULT_SETTINGS,
      ...value?.settings,
      selectedSuppliers: value?.settings?.selectedSuppliers ?? DEFAULT_SETTINGS.selectedSuppliers
    },
    progress: {
      ...DEFAULT_PROGRESS,
      ...value?.progress
    }
  };
}

export async function saveExtensionState(state: ExtensionState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

export async function patchExtensionState(patch: Partial<ExtensionState>): Promise<ExtensionState> {
  const current = await loadExtensionState();
  const next: ExtensionState = {
    ...current,
    ...patch,
    settings: {
      ...current.settings,
      ...patch.settings
    },
    progress: {
      ...current.progress,
      ...patch.progress
    }
  };
  await saveExtensionState(next);
  return next;
}
