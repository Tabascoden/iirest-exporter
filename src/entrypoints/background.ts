import { defineBackground } from "wxt/utils/define-background";
import type {
  ContentRequest,
  ContentResponse,
  DomDiagnostic,
  PageDiagnostic,
  RuntimeEvent,
  RuntimeRequest,
  RuntimeResponse,
  RunProgress,
  StartPurchaseUploadPayload
} from "../lib/messages";
import {
  DEFAULT_PROGRESS,
  loadExtensionState,
  patchExtensionState,
  saveExtensionState,
  type ExtensionSettings,
  type ExtensionState
} from "../lib/storage/results";
import {
  SUPPLIERS,
  type PurchaseUploadItem,
  type SupplierId,
  type SupplierCartResult,
  type SupplierInfo,
  type SupplierSearchResult
} from "../lib/suppliers/types";
import { createLogEntry } from "../lib/utils/logger";
import { sleep } from "../lib/utils/sleep";

const MAX_LOGS = 300;
const MIN_COLLECTION_PAGES = 25;
const VISIBLE_TAB_SUPPLIERS = new Set<SupplierId>(["smartpro", "metro"]);

interface ActivePurchaseTask {
  supplierId: SupplierId;
  item: PurchaseUploadItem;
}

interface ActiveRun {
  id: string;
  mode: "price_export" | "purchase_upload";
  queries: string[];
  purchaseTasks: ActivePurchaseTask[];
  suppliers: SupplierId[];
  settings: ExtensionSettings;
  results: SupplierSearchResult[];
  cartResults: SupplierCartResult[];
  logs: ExtensionState["logs"];
  progress: RunProgress;
  supplierIndex: number;
  queryIndex: number;
  completed: number;
  added: number;
  errors: number;
  total: number;
  stopped: boolean;
  paused: boolean;
  processing: boolean;
  lastRunAt: string;
  currentTabId?: number;
}

interface ActiveTabSnapshot {
  previousTabId: number;
  previousWindowId: number;
  supplierTabId: number;
  supplierWindowId: number;
}

let activeRun: ActiveRun | null = null;

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    void chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => undefined);
  });

  chrome.action.onClicked.addListener((tab) => {
    if (tab.windowId == null) {
      return;
    }
    void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => undefined);
  });

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isRuntimeRequest(message)) {
      return undefined;
    }

    void handleRuntimeRequest(message)
      .then((response) => sendResponse(response))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Неизвестная ошибка background script"
        } satisfies RuntimeResponse)
      );

    return true;
  });
});

function isRuntimeRequest(message: unknown): message is RuntimeRequest {
  if (!message || typeof message !== "object" || !("type" in message)) {
    return false;
  }

  return [
    "START_SEARCH",
    "START_PURCHASE_UPLOAD",
    "STOP_SEARCH",
    "CONTINUE_SEARCH",
    "CLEAR_RESULTS",
    "GET_STATE",
    "SAVE_SETTINGS"
  ].includes(String((message as { type: unknown }).type));
}

async function handleRuntimeRequest(request: RuntimeRequest): Promise<RuntimeResponse> {
  switch (request.type) {
    case "GET_STATE":
      return { ok: true, data: await loadExtensionState() };

    case "SAVE_SETTINGS": {
      if (activeRun) {
        activeRun.settings = request.payload;
      }
      const state = await patchExtensionState({ settings: request.payload });
      await broadcastState(state);
      return { ok: true, data: state };
    }

    case "CLEAR_RESULTS": {
      if (activeRun) {
        activeRun.stopped = true;
        await abortActiveContent(activeRun);
        activeRun = null;
      }

      const current = await loadExtensionState();
      const state: ExtensionState = {
        ...current,
        results: [],
        logs: [],
        progress: { ...DEFAULT_PROGRESS }
      };
      await saveExtensionState(state);
      await broadcastState(state);
      return { ok: true, data: state };
    }

    case "START_SEARCH":
      return startSearchPayload(request.payload);

    case "START_PURCHASE_UPLOAD":
      return startPurchaseUploadPayload(request.payload);

    case "STOP_SEARCH":
      return stopSearch();

    case "CONTINUE_SEARCH":
      return continueSearch();
  }
}

async function startSearchPayload(payload: {
  rawInput: string;
  queries: string[];
  selectedSuppliers: SupplierId[];
  settings: ExtensionSettings;
}): Promise<RuntimeResponse> {
  if (activeRun?.processing && !activeRun.paused) {
    return { ok: false, error: "Поиск уже выполняется." };
  }

  if (payload.queries.length === 0) {
    return { ok: false, error: "Введите хотя бы один товар." };
  }

  if (payload.selectedSuppliers.length === 0) {
    return { ok: false, error: "Выберите хотя бы одного поставщика." };
  }

  const lastRunAt = new Date().toISOString();
  const run: ActiveRun = {
    id: createRunId(),
    mode: "price_export",
    queries: payload.queries,
    purchaseTasks: [],
    suppliers: payload.selectedSuppliers,
    settings: payload.settings,
    results: [],
    cartResults: [],
    logs: [],
    progress: {
      status: "running",
      current: 0,
      total: payload.queries.length * payload.selectedSuppliers.length,
      found: 0,
      errors: 0,
      message: "Идет поиск"
    },
    supplierIndex: 0,
    queryIndex: 0,
    completed: 0,
    added: 0,
    errors: 0,
    total: payload.queries.length * payload.selectedSuppliers.length,
    stopped: false,
    paused: false,
    processing: false,
    lastRunAt
  };

  appendLog(run, `Старт поиска: ${payload.queries.length} запрос(ов), ${payload.selectedSuppliers.length} поставщик(а).`);
  activeRun = run;
  await persistRun(run);

  void processRun(run);
  return { ok: true, data: await loadExtensionState() };
}

async function startPurchaseUploadPayload(payload: StartPurchaseUploadPayload): Promise<RuntimeResponse> {
  if (activeRun?.processing && !activeRun.paused) {
    return { ok: false, error: "Операция уже выполняется." };
  }

  const supplierFiles = payload.supplierFiles.filter((file) => file.items.length > 0);
  if (supplierFiles.length === 0) {
    return { ok: false, error: "Загрузите файл закупки хотя бы для одного поставщика." };
  }

  const purchaseTasks = supplierFiles.flatMap((file) =>
    file.items.map((item) => ({
      supplierId: file.supplierId,
      item
    }))
  );
  const suppliers = supplierFiles.map((file) => file.supplierId);
  const queries = purchaseTasks.map((task) => task.item.name);

  const lastRunAt = new Date().toISOString();
  const run: ActiveRun = {
    id: createRunId(),
    mode: "purchase_upload",
    queries,
    purchaseTasks,
    suppliers,
    settings: payload.settings,
    results: [],
    cartResults: [],
    logs: [],
    progress: {
      status: "running",
      current: 0,
      total: purchaseTasks.length,
      found: 0,
      errors: 0,
      message: "Загружаю закупку в корзину"
    },
    supplierIndex: 0,
    queryIndex: 0,
    completed: 0,
    added: 0,
    errors: 0,
    total: purchaseTasks.length,
    stopped: false,
    paused: false,
    processing: false,
    lastRunAt
  };

  appendLog(
    run,
    `Старт загрузки закупки: ${purchaseTasks.length} позиция(й), ${supplierFiles.length} поставщик(а), только по загруженным файлам.`
  );
  activeRun = run;
  await persistRun(run);

  void processPurchaseUploadRun(run);
  return { ok: true, data: await loadExtensionState() };
}

async function stopSearch(): Promise<RuntimeResponse> {
  if (!activeRun) {
    const state = await patchExtensionState({
      progress: {
        ...DEFAULT_PROGRESS,
        status: "stopped",
        message: "Остановлено пользователем"
      }
    });
    await broadcastState(state);
    return { ok: true, data: state };
  }

  activeRun.stopped = true;
  activeRun.paused = false;
  await abortActiveContent(activeRun);
  activeRun.progress = {
    ...activeRun.progress,
    status: "stopped",
    message: "Остановлено пользователем"
  };
  appendLog(activeRun, "Остановлено пользователем.", "warn");
  await persistRun(activeRun);
  activeRun = null;
  return { ok: true, data: await loadExtensionState() };
}

async function continueSearch(): Promise<RuntimeResponse> {
  if (!activeRun || !activeRun.paused) {
    return { ok: false, error: "Нет приостановленного поиска." };
  }

  activeRun.paused = false;
  activeRun.progress = {
    ...activeRun.progress,
    status: "running",
    message: "Продолжаю поиск",
    loginRequired: undefined
  };
  appendLog(activeRun, "Пользователь продолжил поиск после авторизации.");
  await persistRun(activeRun);

  if (activeRun.mode === "purchase_upload") {
    void processPurchaseUploadRun(activeRun);
  } else {
    void processRun(activeRun);
  }
  return { ok: true, data: await loadExtensionState() };
}

async function processRun(run: ActiveRun): Promise<void> {
  if (run.processing) {
    return;
  }

  run.processing = true;

  try {
    while (!run.stopped && run.supplierIndex < run.suppliers.length) {
      const supplierId = run.suppliers[run.supplierIndex];
      const query = run.queries[run.queryIndex];
      if (!supplierId || !query) {
        advanceRun(run);
        continue;
      }

      const supplier = SUPPLIERS[supplierId];
      updateRunningProgress(run, supplierId, supplier.name, query);
      appendLog(run, `${supplier.name}: поиск "${query}"`, "info", supplierId, query);
      await persistRun(run);

      let activeTabSnapshot: ActiveTabSnapshot | null = null;
      try {
        const tab = await findOrOpenSupplierTab(supplier);
        run.currentTabId = tab.id;
        activeTabSnapshot = await activateSupplierTabForAutomation(tab.id, supplier);
        await prepareSupplierTabForQuery(tab.id, supplier, query);
        await ensureContentReady(tab.id);
        if (!(await waitForSupplierPageVisible(tab.id, supplier))) {
          appendLog(
            run,
            `${supplier.name}: вкладка осталась скрытой, сайт может не загрузить выдачу без активной вкладки.`,
            "warn",
            supplierId,
            query
          );
          await persistRun(run);
        }

        const loginResponse = await sendTabMessage<ContentResponse<{ loggedIn: boolean; reason?: string }>>(
          tab.id,
          { type: "SUPPLIER_DETECT_LOGIN", supplierId }
        );

        if (!loginResponse.ok) {
          throw new Error(loginResponse.error);
        }

        if (!loginResponse.data.loggedIn) {
          run.paused = true;
          run.processing = false;
          run.progress = {
            ...run.progress,
            status: "login_required",
            message: `Требуется авторизация на ${supplier.name}. Откройте сайт, войдите и нажмите «Продолжить».`,
            loginRequired: {
              supplierId,
              supplierName: supplier.name,
              tabId: tab.id
            }
          };
          appendLog(
            run,
            `${supplier.name}: требуется авторизация${loginResponse.data.reason ? ` (${loginResponse.data.reason})` : ""}`,
            "warn",
            supplierId,
            query
          );
          await activateTab(tab.id);
          await persistRun(run);
          return;
        }

        const searchResponse = await sendTabMessage<ContentResponse<SupplierSearchResult[]>>(tab.id, {
          type: "SUPPLIER_SEARCH",
          supplierId,
          runId: run.id,
          query,
          options: {
            maxPages: getEffectiveMaxPages(run.settings),
            delayMs: run.settings.delayBetweenPagesMs
          }
        } satisfies ContentRequest);

        if (run.stopped) {
          break;
        }

        if (!searchResponse.ok) {
          recordSearchError(run, supplierId, query, searchResponse.error, searchResponse.diagnostic);
        } else if (searchResponse.data.length === 0) {
          appendLog(run, `${supplier.name}: по запросу "${query}" ничего не найдено.`, "info", supplierId, query);
        } else {
          run.results.push(...searchResponse.data);
          appendLog(
            run,
            `${supplier.name}: найдено ${searchResponse.data.length} товар(ов).`,
            "info",
            supplierId,
            query
          );
        }
      } catch (error: unknown) {
        if (run.stopped) {
          break;
        }
        recordSearchError(
          run,
          supplierId,
          query,
          error instanceof Error ? error.message : "Неизвестная ошибка поставщика"
        );
      } finally {
        if (!run.paused && !run.stopped) {
          await restoreActiveTab(activeTabSnapshot);
        }
      }

      run.completed += 1;
      advanceRun(run);
      updateCompletedProgress(run);
      await persistRun(run);

      if (!isRunDone(run) && !run.stopped) {
        await sleep(run.settings.delayBetweenQueriesMs);
      }
    }

    if (run.stopped) {
      run.progress = {
        ...run.progress,
        status: "stopped",
        message: "Остановлено пользователем"
      };
      activeRun = null;
    } else if (!run.paused) {
      run.progress = {
        ...run.progress,
        status: "completed",
        current: run.total,
        message: "Поиск завершен"
      };
      appendLog(run, "Поиск завершен.");
      activeRun = null;
    }

    await persistRun(run);
  } finally {
    run.processing = false;
  }
}

async function processPurchaseUploadRun(run: ActiveRun): Promise<void> {
  if (run.processing) {
    return;
  }

  run.processing = true;

  try {
    while (!run.stopped && run.completed < run.purchaseTasks.length) {
      const task = run.purchaseTasks[run.completed];
      if (!task) {
        run.completed += 1;
        continue;
      }
      const { supplierId, item } = task;

      const supplier = SUPPLIERS[supplierId];
      updatePurchaseRunningProgress(run, supplierId, supplier.name, item);
      appendLog(run, `${supplier.name}: добавление "${item.name}" x ${item.quantity}`, "info", supplierId, item.name);
      await persistRun(run);

      let activeTabSnapshot: ActiveTabSnapshot | null = null;
      try {
        const tab = await findOrOpenSupplierTab(supplier);
        run.currentTabId = tab.id;
        activeTabSnapshot = await activateSupplierTabForAutomation(tab.id, supplier);
        await prepareSupplierTabForQuery(tab.id, supplier, item.name);
        await ensureContentReady(tab.id);
        if (!(await waitForSupplierPageVisible(tab.id, supplier))) {
          appendLog(
            run,
            `${supplier.name}: вкладка осталась скрытой, сайт может не загрузить выдачу без активной вкладки.`,
            "warn",
            supplierId,
            item.name
          );
          await persistRun(run);
        }

        const loginResponse = await sendTabMessage<ContentResponse<{ loggedIn: boolean; reason?: string }>>(
          tab.id,
          { type: "SUPPLIER_DETECT_LOGIN", supplierId }
        );

        if (!loginResponse.ok) {
          throw new Error(loginResponse.error);
        }

        if (!loginResponse.data.loggedIn) {
          run.paused = true;
          run.processing = false;
          run.progress = {
            ...run.progress,
            status: "login_required",
            message: `Требуется авторизация на ${supplier.name}. Откройте сайт, войдите и нажмите «Продолжить».`,
            loginRequired: {
              supplierId,
              supplierName: supplier.name,
              tabId: tab.id
            }
          };
          appendLog(
            run,
            `${supplier.name}: требуется авторизация${loginResponse.data.reason ? ` (${loginResponse.data.reason})` : ""}`,
            "warn",
            supplierId,
            item.name
          );
          await activateTab(tab.id);
          await persistRun(run);
          return;
        }

        const cartResponse = await sendTabMessage<ContentResponse<SupplierCartResult>>(tab.id, {
          type: "SUPPLIER_ADD_TO_CART",
          supplierId,
          runId: run.id,
          item,
          options: {
            maxPages: getEffectiveMaxPages(run.settings),
            delayMs: run.settings.delayBetweenPagesMs
          }
        } satisfies ContentRequest);

        if (run.stopped) {
          break;
        }

        if (!cartResponse.ok) {
          recordPurchaseError(run, supplierId, item, cartResponse.error, cartResponse.diagnostic);
        } else if (cartResponse.data.status === "added") {
          run.cartResults.push(cartResponse.data);
          run.added += 1;
          appendLog(
            run,
            `${supplier.name}: добавлено "${cartResponse.data.matchedName ?? item.name}" x ${item.quantity}.`,
            "info",
            supplierId,
            item.name
          );
        } else {
          run.cartResults.push(cartResponse.data);
          run.errors += 1;
          appendLog(
            run,
            `${supplier.name}: не добавлено "${item.name}": ${cartResponse.data.message ?? cartResponse.data.status}`,
            cartResponse.data.status === "not_found" ? "warn" : "error",
            supplierId,
            item.name
          );
        }
      } catch (error: unknown) {
        if (run.stopped) {
          break;
        }
        recordPurchaseError(
          run,
          supplierId,
          item,
          error instanceof Error ? error.message : "Неизвестная ошибка поставщика"
        );
      } finally {
        if (!run.paused && !run.stopped) {
          await restoreActiveTab(activeTabSnapshot);
        }
      }

      run.completed += 1;
      updateCompletedProgress(run);
      await persistRun(run);

      if (!isRunDone(run) && !run.stopped) {
        await sleep(run.settings.delayBetweenQueriesMs);
      }
    }

    if (run.stopped) {
      run.progress = {
        ...run.progress,
        status: "stopped",
        message: "Остановлено пользователем"
      };
      activeRun = null;
    } else if (!run.paused) {
      run.progress = {
        ...run.progress,
        status: "completed",
        current: run.total,
        message: "Загрузка закупки завершена"
      };
      appendLog(run, `Загрузка закупки завершена. Добавлено: ${run.added}, ошибок: ${run.errors}.`);
      activeRun = null;
    }

    await persistRun(run);
  } finally {
    run.processing = false;
  }
}

function updateRunningProgress(run: ActiveRun, supplierId: SupplierId, supplierName: string, query: string): void {
  run.progress = {
    status: "running",
    supplierId,
    supplierName,
    query,
    current: Math.min(run.completed + 1, run.total),
    total: run.total,
    found: run.results.length,
    errors: run.errors,
    message: "Идет поиск"
  };
}

function updatePurchaseRunningProgress(
  run: ActiveRun,
  supplierId: SupplierId,
  supplierName: string,
  item: PurchaseUploadItem
): void {
  run.progress = {
    status: "running",
    supplierId,
    supplierName,
    query: item.name,
    current: Math.min(run.completed + 1, run.total),
    total: run.total,
    found: run.added,
    errors: run.errors,
    message: "Загружаю закупку в корзину"
  };
}

function updateCompletedProgress(run: ActiveRun): void {
  run.progress = {
    ...run.progress,
    current: run.completed,
    found: getRunFound(run),
    errors: run.errors
  };
}

function recordSearchError(
  run: ActiveRun,
  supplierId: SupplierId,
  query: string,
  message: string,
  diagnostic?: DomDiagnostic
): void {
  run.errors += 1;
  const supplier = SUPPLIERS[supplierId];
  appendLog(run, `${supplier.name}: ошибка по запросу "${query}": ${message}`, "error", supplierId, query);

  if (diagnostic) {
    appendLog(
      run,
      [
        `${supplier.name}: DOM diagnostic`,
        `url=${diagnostic.url}`,
        `title=${diagnostic.title}`,
        `visibility=${diagnostic.visibilityState ?? "unknown"}`,
        `focus=${diagnostic.hasFocus ?? "unknown"}`,
        `searchInput=${diagnostic.searchInputFound}`,
        `productRows=${diagnostic.productRowsFound}`,
        `adapter=${diagnostic.adapter}`
      ].join("; "),
      "error",
      supplierId,
      query
    );
  }
}

function recordPurchaseError(
  run: ActiveRun,
  supplierId: SupplierId,
  item: PurchaseUploadItem,
  message: string,
  diagnostic?: DomDiagnostic
): void {
  run.errors += 1;
  const supplier = SUPPLIERS[supplierId];
  appendLog(run, `${supplier.name}: ошибка добавления "${item.name}" x ${item.quantity}: ${message}`, "error", supplierId, item.name);

  if (diagnostic) {
    appendLog(
      run,
      [
        `${supplier.name}: DOM diagnostic`,
        `url=${diagnostic.url}`,
        `title=${diagnostic.title}`,
        `visibility=${diagnostic.visibilityState ?? "unknown"}`,
        `focus=${diagnostic.hasFocus ?? "unknown"}`,
        `searchInput=${diagnostic.searchInputFound}`,
        `productRows=${diagnostic.productRowsFound}`,
        `adapter=${diagnostic.adapter}`
      ].join("; "),
      "error",
      supplierId,
      item.name
    );
  }
}

function advanceRun(run: ActiveRun): void {
  run.queryIndex += 1;
  if (run.queryIndex >= run.queries.length) {
    run.queryIndex = 0;
    run.supplierIndex += 1;
  }
}

function isRunDone(run: ActiveRun): boolean {
  if (run.mode === "purchase_upload") {
    return run.completed >= run.total;
  }

  return run.supplierIndex >= run.suppliers.length || run.completed >= run.total;
}

function getRunFound(run: ActiveRun): number {
  return run.mode === "purchase_upload" ? run.added : run.results.length;
}

function getEffectiveMaxPages(settings: ExtensionSettings): number {
  return Math.max(settings.maxPagesPerQuery, MIN_COLLECTION_PAGES);
}

function appendLog(
  run: ActiveRun,
  message: string,
  level: ExtensionState["logs"][number]["level"] = "info",
  supplierId?: SupplierId,
  query?: string
): void {
  run.logs = [...run.logs, createLogEntry(message, level, { supplierId, query })].slice(-MAX_LOGS);
}

async function persistRun(run: ActiveRun): Promise<ExtensionState> {
  const state: ExtensionState = {
    results: run.results,
    lastRunAt: run.lastRunAt,
    lastInputItems: run.queries,
    settings: run.settings,
    logs: run.logs,
    progress: {
      ...run.progress,
      found: getRunFound(run),
      errors: run.errors
    }
  };

  await saveExtensionState(state);
  await broadcastState(state);
  return state;
}

async function broadcastState(state: ExtensionState): Promise<void> {
  const event: RuntimeEvent = {
    type: "STATE_CHANGED",
    payload: {
      progress: state.progress,
      results: state.results,
      logs: state.logs
    }
  };

  await sendRuntimeMessage(event).catch(() => undefined);
}

async function findOrOpenSupplierTab(supplier: SupplierInfo): Promise<chrome.tabs.Tab & { id: number }> {
  const tabs = await tabsQuery({});
  const existing = tabs.find((tab) => {
    if (tab.id == null || !tab.url) {
      return false;
    }
    return isUsableSupplierTab(tab.url, supplier);
  });

  const tab = existing ?? (await tabsCreate({ url: supplier.startUrl, active: false }));
  if (tab.id == null) {
    throw new Error(`Не удалось открыть вкладку ${supplier.name}.`);
  }

  await waitForTabComplete(tab.id);
  return tab as chrome.tabs.Tab & { id: number };
}

async function prepareSupplierTabForQuery(tabId: number, supplier: SupplierInfo, query: string): Promise<void> {
  const targetUrl = supplier.searchUrl?.(query);
  if (!targetUrl) {
    return;
  }

  const currentTab = await tabsGet(tabId).catch(() => undefined);
  if (currentTab?.url === targetUrl) {
    return;
  }

  await tabsUpdate(tabId, { url: targetUrl });
  await waitForTabComplete(tabId);
}

function isUsableSupplierTab(url: string, supplier: SupplierInfo): boolean {
  if (!supplier.hostPatterns.some((host) => isUrlOnHost(url, host))) {
    return false;
  }

  if (!supplier.searchPathPrefix) {
    return true;
  }

  try {
    const parsed = new URL(url);
    return (
      parsed.pathname === supplier.searchPathPrefix ||
      parsed.pathname.startsWith(`${supplier.searchPathPrefix}/`)
    );
  } catch {
    return false;
  }
}

async function ensureContentReady(tabId: number): Promise<void> {
  try {
    await sendTabMessage<ContentResponse>(tabId, { type: "SUPPLIER_PING" });
    return;
  } catch {
    await tabsReload(tabId);
    await waitForTabComplete(tabId);
    await sleep(500);
    await sendTabMessage<ContentResponse>(tabId, { type: "SUPPLIER_PING" });
  }
}

async function activateSupplierTabForAutomation(
  tabId: number,
  supplier: SupplierInfo
): Promise<ActiveTabSnapshot | null> {
  if (!VISIBLE_TAB_SUPPLIERS.has(supplier.id)) {
    return null;
  }

  const targetTab = await tabsGet(tabId);
  const previousTab = await getLastFocusedActiveTab().catch(() => null);
  const snapshot =
    previousTab && previousTab.id !== tabId
      ? {
          previousTabId: previousTab.id,
          previousWindowId: previousTab.windowId,
          supplierTabId: tabId,
          supplierWindowId: targetTab.windowId
        }
      : null;

  await activateTab(tabId);
  return snapshot;
}

async function waitForSupplierPageVisible(tabId: number, supplier: SupplierInfo): Promise<boolean> {
  if (!VISIBLE_TAB_SUPPLIERS.has(supplier.id)) {
    return true;
  }

  for (let attempt = 0; attempt < 24; attempt += 1) {
    try {
      const response = await sendTabMessage<ContentResponse<PageDiagnostic>>(tabId, { type: "SUPPLIER_PING" });
      if (response.ok && response.data.visibilityState === "visible") {
        return true;
      }
    } catch {
      // The next retry can recover after navigation or content-script reinjection.
    }

    await activateTab(tabId);
    await sleep(250);
  }

  return false;
}

async function activateTab(tabId: number): Promise<void> {
  const tab = await tabsUpdate(tabId, { active: true }).catch(() => undefined);
  const windowId = tab?.windowId ?? (await tabsGet(tabId).catch(() => undefined))?.windowId;
  if (windowId != null) {
    await windowsUpdate(windowId, { focused: true }).catch(() => undefined);
  }
}

async function restoreActiveTab(snapshot: ActiveTabSnapshot | null): Promise<void> {
  if (!snapshot) {
    return;
  }

  const lastFocusedTab = await getLastFocusedActiveTab().catch(() => null);
  if (lastFocusedTab?.id !== snapshot.supplierTabId || lastFocusedTab.windowId !== snapshot.supplierWindowId) {
    return;
  }

  await tabsUpdate(snapshot.previousTabId, { active: true }).catch(() => undefined);
  await windowsUpdate(snapshot.previousWindowId, { focused: true }).catch(() => undefined);
}

async function getLastFocusedActiveTab(): Promise<chrome.tabs.Tab & { id: number; windowId: number }> {
  const [tab] = await tabsQuery({ active: true, lastFocusedWindow: true });
  if (tab?.id == null) {
    throw new Error("Chrome did not return the active tab.");
  }

  return tab as chrome.tabs.Tab & { id: number; windowId: number };
}

async function abortActiveContent(run: ActiveRun): Promise<void> {
  if (run.currentTabId == null) {
    return;
  }

  await sendTabMessage<ContentResponse>(run.currentTabId, {
    type: "SUPPLIER_ABORT",
    runId: run.id
  }).catch(() => undefined);
}

function isUrlOnHost(url: string, host: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === host || parsed.hostname.endsWith(`.${host}`);
  } catch {
    return false;
  }
}

function createRunId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sendRuntimeMessage(message: RuntimeEvent): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function sendTabMessage<T>(tabId: number, message: ContentRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response: T) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function tabsQuery(queryInfo: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tabs);
    });
  });
}

function tabsCreate(createProperties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!tab) {
        reject(new Error("Chrome did not return the created tab."));
        return;
      }
      resolve(tab);
    });
  });
}

function tabsUpdate(tabId: number, updateProperties: chrome.tabs.UpdateProperties): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!tab) {
        reject(new Error("Chrome did not return the updated tab."));
        return;
      }
      resolve(tab);
    });
  });
}

function windowsUpdate(windowId: number, updateInfo: chrome.windows.UpdateInfo): Promise<chrome.windows.Window> {
  return new Promise((resolve, reject) => {
    chrome.windows.update(windowId, updateInfo, (window) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!window) {
        reject(new Error("Chrome did not return the updated window."));
        return;
      }
      resolve(window);
    });
  });
}

function tabsReload(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.tabs.reload(tabId, {}, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

async function waitForTabComplete(tabId: number): Promise<void> {
  const currentTab = await tabsGet(tabId).catch(() => undefined);
  if (currentTab?.status === "complete") {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeoutId = globalThis.setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 20000);

    const listener = (updatedTabId: number, changeInfo: chrome.tabs.OnUpdatedInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        globalThis.clearTimeout(timeoutId);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);
  });
}

function tabsGet(tabId: number): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tab);
    });
  });
}
