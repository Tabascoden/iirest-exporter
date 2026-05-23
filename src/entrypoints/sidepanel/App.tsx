import { AlertTriangle, Download, FileUp, LogIn, Play, Square, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import iirestLogo from "../../assets/iirest-logo.svg";
import { buildSupplierCsv, buildSupplierCsvFilename } from "../../lib/export/csv";
import {
  type IirestImportResponse,
  normalizeIirestBaseUrl,
  type IirestImportMode
} from "../../lib/iirest/import";
import type { LogEntry, RuntimeEvent, RuntimeRequest, RuntimeResponse, RunStatus } from "../../lib/messages";
import { parsePurchaseFile } from "../../lib/purchase/file";
import {
  DEFAULT_PROGRESS,
  DEFAULT_SETTINGS,
  loadExtensionState,
  type ExtensionSettings,
  type ExtensionState
} from "../../lib/storage/results";
import {
  SUPPLIER_IDS,
  SUPPLIERS,
  type PurchaseUploadItem,
  type SupplierId,
  type SupplierSearchResult
} from "../../lib/suppliers/types";
import { normalizeInputItems } from "../../lib/utils/input";

type WorkflowMode = "price_export" | "purchase_upload";

interface SupplierPurchaseFileState {
  fileName: string;
  items: PurchaseUploadItem[];
  warnings: string[];
}

const statusLabels: Record<RunStatus, string> = {
  idle: "готово",
  running: "идет поиск",
  login_required: "требуется авторизация",
  stopped: "остановлено",
  completed: "завершено",
  error: "ошибка"
};

export default function App() {
  const [mode, setMode] = useState<WorkflowMode>("price_export");
  const [rawInput, setRawInput] = useState("");
  const [purchaseFiles, setPurchaseFiles] = useState<Partial<Record<SupplierId, SupplierPurchaseFileState>>>({});
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [results, setResults] = useState<SupplierSearchResult[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [progress, setProgress] = useState(DEFAULT_PROGRESS);
  const [message, setMessage] = useState("");
  const [errorDetailsOpen, setErrorDetailsOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [iirestLoginRequired, setIirestLoginRequired] = useState(false);

  const isRunning = progress.status === "running";
  const isLoginRequired = progress.status === "login_required";
  const canStop = isRunning || isLoginRequired;
  const normalizedItems = useMemo(() => normalizeInputItems(rawInput), [rawInput]);
  const purchaseSupplierFiles = useMemo(
    () =>
      SUPPLIER_IDS.map((supplierId) => ({
        supplierId,
        file: purchaseFiles[supplierId]
      })).filter((entry): entry is { supplierId: SupplierId; file: SupplierPurchaseFileState } =>
        Boolean(entry.file && entry.file.items.length > 0)
      ),
    [purchaseFiles]
  );
  const purchaseTotalItems = useMemo(
    () => purchaseSupplierFiles.reduce((total, entry) => total + entry.file.items.length, 0),
    [purchaseSupplierFiles]
  );
  const suppliersWithPurchaseFiles = useMemo(
    () => purchaseSupplierFiles.map((entry) => SUPPLIERS[entry.supplierId].name).join(", ") || "—",
    [purchaseSupplierFiles]
  );
  const suppliersWithResults = useMemo(() => {
    const supplierNames = new Set(results.map((result) => result.supplierName));
    return Array.from(supplierNames).join(", ") || "—";
  }, [results]);
  const statusSupplierValue = mode === "purchase_upload" ? suppliersWithPurchaseFiles : suppliersWithResults;
  const statusCountLabel = mode === "purchase_upload" ? "Добавлено" : "Найдено строк";
  const statusCountValue = mode === "purchase_upload" ? String(progress.found) : String(results.length);
  const statusText = progress.message || statusLabels[progress.status];
  const issueLogs = useMemo(
    () => logs.filter((log) => log.level === "error" || log.level === "warn").slice(-80).reverse(),
    [logs]
  );
  const hasIssueDetails = progress.errors > 0 || issueLogs.length > 0;

  useEffect(() => {
    void loadExtensionState().then((state) => {
      applyState(state);
      setRawInput(state.lastInputItems.join("\n"));
    });

    const listener = (event: RuntimeEvent) => {
      if (event.type === "STATE_CHANGED") {
        setProgress(event.payload.progress);
        setResults(event.payload.results);
        setLogs(event.payload.logs);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  function applyState(state: ExtensionState) {
    setSettings(state.settings);
    setResults(state.results);
    setLogs(state.logs);
    setProgress(state.progress);
  }

  async function updateSettings(patch: Partial<ExtensionSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    await sendRuntimeMessage<ExtensionState>({ type: "SAVE_SETTINGS", payload: next }).then(applyResponse);
  }

  async function startSearch() {
    setIirestLoginRequired(false);
    const queries = normalizeInputItems(rawInput);
    if (queries.length === 0) {
      setMessage("Введите хотя бы один товар.");
      return;
    }

    if (settings.selectedSuppliers.length === 0) {
      setMessage("Выберите хотя бы одного поставщика.");
      return;
    }

    setMessage("");
    const response = await sendRuntimeMessage<ExtensionState>({
      type: "START_SEARCH",
      payload: {
        rawInput,
        queries,
        selectedSuppliers: settings.selectedSuppliers,
        settings
      }
    });
    applyResponse(response);
  }

  async function handlePurchaseFile(supplierId: SupplierId, file: File | undefined) {
    if (!file) {
      return;
    }

    setIirestLoginRequired(false);
    setMessage("");

    try {
      const parsed = await parsePurchaseFile(file);
      setPurchaseFiles((current) => ({
        ...current,
        [supplierId]: {
          fileName: file.name,
          items: parsed.items,
          warnings: parsed.warnings
        }
      }));
      if (parsed.items.length === 0) {
        setMessage(`${SUPPLIERS[supplierId].name}: в файле не найдено строк с товаром, количеством и ценой.`);
      }
    } catch (error) {
      setPurchaseFiles((current) => {
        const next = { ...current };
        delete next[supplierId];
        return next;
      });
      setMessage(error instanceof Error ? error.message : "Не удалось прочитать файл закупки.");
    }
  }

  async function startPurchaseUpload() {
    setIirestLoginRequired(false);
    if (purchaseSupplierFiles.length === 0) {
      setMessage("Загрузите файл закупки хотя бы для одного поставщика.");
      return;
    }

    setMessage("");
    const response = await sendRuntimeMessage<ExtensionState>({
      type: "START_PURCHASE_UPLOAD",
      payload: {
        supplierFiles: purchaseSupplierFiles.map((entry) => ({
          supplierId: entry.supplierId,
          fileName: entry.file.fileName,
          items: entry.file.items
        })),
        settings
      }
    });
    applyResponse(response);
  }

  function startCurrentWorkflow() {
    if (mode === "purchase_upload") {
      void startPurchaseUpload();
      return;
    }

    void startSearch();
  }

  async function stopSearch() {
    const response = await sendRuntimeMessage<ExtensionState>({ type: "STOP_SEARCH" });
    applyResponse(response);
  }

  async function clearResults() {
    if (mode === "purchase_upload") {
      setPurchaseFiles({});
    }

    const response = await sendRuntimeMessage<ExtensionState>({ type: "CLEAR_RESULTS" });
    applyResponse(response);
  }

  async function exportCsv() {
    setIirestLoginRequired(false);
    if (results.length === 0) {
      setMessage("Нет результатов для экспорта.");
      return;
    }

    const supplierGroups = groupResultsBySupplier(results);
    const urls: string[] = [];
    const exportedAt = new Date();

    try {
      for (const group of supplierGroups) {
        const csv = buildSupplierCsv(group.results, {
          includeTechnicalColumns: settings.includeTechnicalColumns
        });
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        urls.push(url);

        await downloadFile(
          url,
          buildSupplierCsvFilename(group.supplierName, exportedAt),
          supplierGroups.length === 1
        );
      }
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось скачать CSV.");
    } finally {
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
    }
  }

  async function writeResultsToIirest(mode: IirestImportMode) {
    if (results.length === 0) {
      setMessage("Нет результатов для записи.");
      return;
    }

    setIsImporting(true);
    setMessage("");
    setIirestLoginRequired(false);
    try {
      const response = await sendRuntimeMessage<IirestImportResponse>({
        type: "IMPORT_PRICES_TO_IIREST",
        payload: {
          baseUrl: settings.iirestBaseUrl,
          mode,
          results
        }
      });
      if (!response.ok) {
        if (response.status === 401) {
          setIirestLoginRequired(true);
        }
        setMessage(
          response.status === 401
            ? "Нужно войти в iiRest. Откройте iiRest, авторизуйтесь и повторите запись."
            : response.error
        );
        return;
      }

      if (!response.data) {
        setMessage("iiRest вернул неожиданный ответ.");
        return;
      }

      const supplierNames = response.data.suppliers.map((supplier) => supplier.supplier_name).join(", ");
      const skippedText = response.data.skipped > 0 ? ` Пропущено: ${response.data.skipped}.` : "";
      setMessage(`Записано в iiRest: ${response.data.imported}. Поставщики: ${supplierNames || "—"}.${skippedText}`);
      setImportDialogOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось записать результаты в iiRest.");
    } finally {
      setIsImporting(false);
    }
  }

  function openIirestLogin() {
    try {
      chrome.tabs.create({ url: normalizeIirestBaseUrl(settings.iirestBaseUrl) });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось открыть iiRest.");
    }
  }

  function applyResponse(response: RuntimeResponse<ExtensionState>) {
    if (!response.ok) {
      setIirestLoginRequired(false);
      setMessage(response.error);
      return;
    }

    if (response.data) {
      applyState(response.data);
    }
  }

  function toggleSupplier(supplierId: SupplierId, checked: boolean) {
    const selected = new Set(settings.selectedSuppliers);
    if (checked) {
      selected.add(supplierId);
    } else {
      selected.delete(supplierId);
    }

    void updateSettings({
      selectedSuppliers: SUPPLIER_IDS.filter((id) => selected.has(id))
    });
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <img src={iirestLogo} alt="" />
          </span>
          <div>
            <h1>iiRest Exporter</h1>
            <p>{statusText}</p>
          </div>
        </div>
        <span className={`status-pill status-${progress.status}`}>{statusLabels[progress.status]}</span>
      </header>

      <section className="panel-section mode-section">
        <label className="field-label" htmlFor="workflow">
          Сценарий
        </label>
        <select
          id="workflow"
          value={mode}
          onChange={(event) => setMode(event.target.value as WorkflowMode)}
          disabled={isRunning}
        >
          <option value="price_export">Выгрузить цены</option>
          <option value="purchase_upload">Загрузить закупку</option>
        </select>
      </section>

      {message && (
        <div className={`notice${iirestLoginRequired ? " notice-actionable" : ""}`}>
          <span>{message}</span>
          {iirestLoginRequired && (
            <button className="notice-action" type="button" onClick={openIirestLogin}>
              <LogIn size={16} />
              Открыть iiRest
            </button>
          )}
        </div>
      )}

      {mode === "price_export" && (
      <section className="panel-section">
        <label className="field-label" htmlFor="items">
          Товары
        </label>
        <textarea
          id="items"
          value={rawInput}
          onChange={(event) => setRawInput(event.target.value)}
          placeholder={"Молоко 3.2\nСыр 500 г\nСтакан бумажный 250 мл"}
          spellCheck={false}
        />
        <div className="input-meta">Запросов: {normalizedItems.length}</div>
      </section>
      )}

      <section className="panel-section">
        <div className="section-title">Поставщики</div>
        {mode === "price_export" ? (
          <div className="checkbox-stack">
            {SUPPLIER_IDS.map((supplierId) => (
              <label key={supplierId} className="check-row">
                <input
                  type="checkbox"
                  checked={settings.selectedSuppliers.includes(supplierId)}
                  onChange={(event) => toggleSupplier(supplierId, event.target.checked)}
                  disabled={isRunning}
                />
                <span>{SUPPLIERS[supplierId].name}</span>
              </label>
            ))}
          </div>
        ) : (
          <div className="supplier-upload-stack">
            {SUPPLIER_IDS.map((supplierId) => {
              const supplierFile = purchaseFiles[supplierId];
              const inputId = `purchase-file-${supplierId}`;
              return (
                <div key={supplierId} className="supplier-upload-row">
                  <div className="supplier-upload-info">
                    <strong>{SUPPLIERS[supplierId].name}</strong>
                    <span>
                      {supplierFile
                        ? `${supplierFile.fileName} · позиций: ${supplierFile.items.length}`
                        : "Файл не загружен"}
                    </span>
                  </div>
                  <label className="upload-button" htmlFor={inputId}>
                    <FileUp size={16} />
                    Загрузить
                  </label>
                  <input
                    id={inputId}
                    className="file-input"
                    type="file"
                    accept=".xlsx,.xls,.csv,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    onChange={(event) => void handlePurchaseFile(supplierId, event.target.files?.[0])}
                    disabled={isRunning}
                  />
                  {supplierFile?.warnings.length ? (
                    <div className="warning-list supplier-warning-list">
                      {supplierFile.warnings.slice(0, 2).map((warning) => (
                        <div key={warning}>{warning}</div>
                      ))}
                      {supplierFile.warnings.length > 2 && (
                        <div>Еще предупреждений: {supplierFile.warnings.length - 2}</div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div className="input-meta">К запуску: {purchaseTotalItems}</div>
          </div>
        )}
      </section>

      {mode === "price_export" && (
        <section className="panel-section">
          <label className="field-label" htmlFor="iirest-url">
            iiRest URL
          </label>
          <input
            id="iirest-url"
            className="url-input"
            type="url"
            value={settings.iirestBaseUrl}
            onChange={(event) => void updateSettings({ iirestBaseUrl: event.target.value })}
            disabled={isRunning || isImporting}
          />
        </section>
      )}

      <section className="actions">
        <button
          className="primary-button"
          type="button"
          onClick={startCurrentWorkflow}
          disabled={isRunning || (mode === "purchase_upload" && purchaseSupplierFiles.length === 0)}
        >
          <Play size={16} />
          {mode === "purchase_upload" ? "Собрать" : "Начать"}
        </button>
        <button type="button" onClick={stopSearch} disabled={!canStop}>
          <Square size={16} />
          Остановить
        </button>
        <button type="button" onClick={clearResults} disabled={isRunning && results.length === 0}>
          <Trash2 size={16} />
          Очистить
        </button>
        {mode === "price_export" && (
        <button type="button" onClick={exportCsv} disabled={results.length === 0}>
          <Download size={16} />
          Выгрузить
        </button>
        )}
        {mode === "price_export" && (
        <button
          type="button"
          onClick={() => setImportDialogOpen(true)}
          disabled={results.length === 0 || isRunning || isImporting}
        >
          <FileUp size={16} />
          Записать
        </button>
        )}
      </section>

      {mode === "price_export" && importDialogOpen && (
        <section className="import-choice" aria-live="polite">
          <div className="import-choice-header">
            <div>
              <span className="section-title">Записать в iiRest</span>
              <p>Строк: {results.length}</p>
            </div>
            <button
              className="icon-button"
              type="button"
              onClick={() => setImportDialogOpen(false)}
              title="Скрыть"
              disabled={isImporting}
            >
              <X size={16} />
            </button>
          </div>
          <div className="import-choice-actions">
            <button type="button" onClick={() => void writeResultsToIirest("append")} disabled={isImporting}>
              <FileUp size={16} />
              Дополнить
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={() => void writeResultsToIirest("replace")}
              disabled={isImporting}
            >
              <Trash2 size={16} />
              Перезаписать
            </button>
          </div>
          <p className="import-warning">Перезаписать заменит прайс поставщика текущей выгрузкой.</p>
        </section>
      )}

      <section className="progress-grid">
        <Metric label="Статус" value={statusText} />
        <Metric label="Поставщики" value={statusSupplierValue} />
        <Metric label={statusCountLabel} value={statusCountValue} />
        <Metric
          label="Ошибок"
          value={String(progress.errors)}
          active={errorDetailsOpen}
          disabled={!hasIssueDetails}
          title={hasIssueDetails ? "Показать детали ошибок" : "Ошибок нет"}
          onClick={() => setErrorDetailsOpen((open) => !open)}
        />
      </section>

      {errorDetailsOpen && (
        <ErrorDetailsPanel logs={issueLogs} onClose={() => setErrorDetailsOpen(false)} />
      )}
    </main>
  );
}

function Metric({
  label,
  value,
  active = false,
  disabled = false,
  title,
  onClick
}: {
  label: string;
  value: string;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </>
  );

  if (onClick) {
    return (
      <button
        className={`metric metric-button${active ? " metric-button-active" : ""}`}
        type="button"
        title={title ?? value}
        onClick={onClick}
        disabled={disabled}
      >
        {content}
      </button>
    );
  }

  return <div className="metric">{content}</div>;
}

function ErrorDetailsPanel({ logs, onClose }: { logs: LogEntry[]; onClose: () => void }) {
  return (
    <section className="error-details" aria-live="polite">
      <div className="error-details-header">
        <div>
          <span className="section-title">Детали ошибок</span>
          <p>{logs.length ? `Показано записей: ${logs.length}` : "Подробных записей пока нет."}</p>
        </div>
        <button className="icon-button" type="button" onClick={onClose} title="Скрыть детали">
          <X size={16} />
        </button>
      </div>

      {logs.length ? (
        <div className="error-log-list">
          {logs.map((log) => (
            <article key={log.id} className={`error-log-item log-${log.level}`}>
              <div className="error-log-icon" aria-hidden="true">
                <AlertTriangle size={15} />
              </div>
              <div className="error-log-body">
                <div className="error-log-meta">
                  <span>{formatLogTime(log.at)}</span>
                  {log.supplierId && <span>{SUPPLIERS[log.supplierId].name}</span>}
                  {log.query && <span title={log.query}>{log.query}</span>}
                </div>
                <p>{log.message}</p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-error-state">Ошибок в журнале нет.</div>
      )}
    </section>
  );
}

function formatLogTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function groupResultsBySupplier(results: SupplierSearchResult[]): Array<{
  supplierId: SupplierId;
  supplierName: string;
  results: SupplierSearchResult[];
}> {
  const groups = new Map<SupplierId, { supplierId: SupplierId; supplierName: string; results: SupplierSearchResult[] }>();

  for (const result of results) {
    const group = groups.get(result.supplierId);
    if (group) {
      group.results.push(result);
      continue;
    }

    groups.set(result.supplierId, {
      supplierId: result.supplierId,
      supplierName: result.supplierName,
      results: [result]
    });
  }

  return Array.from(groups.values());
}

function sendRuntimeMessage<T>(message: RuntimeRequest): Promise<RuntimeResponse<T>> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: RuntimeResponse<T>) => {
      const error = chrome.runtime.lastError;
      if (error) {
        resolve({ ok: false, error: error.message ?? "Chrome runtime error." });
        return;
      }
      resolve(response ?? { ok: false, error: "Background script не ответил." });
    });
  });
}

function downloadFile(url: string, filename: string, saveAs: boolean): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename,
        saveAs
      },
      (downloadId) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(downloadId);
      }
    );
  });
}
