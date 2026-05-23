import type { DomDiagnostic } from "../messages";
import type {
  PurchaseUploadItem,
  SupplierAdapter,
  SupplierCartResult,
  SupplierId,
  SupplierSearchResult
} from "./types";
import {
  clickElement,
  findClickableByText,
  getClosestUrl,
  getText,
  isDisabled,
  isVisible,
  normalizeWhitespace,
  pressEnter,
  queryAllUnique,
  queryFirst,
  setInputValue,
  waitFor
} from "../utils/dom";
import { extractPrice, parseNormalizedPrice } from "../utils/price";
import { sleep, throwIfAborted } from "../utils/sleep";
import { extractUnitFromPrice, extractUnitOrPackage } from "../utils/units";

export interface SupplierSelectorConfig {
  searchInput: string[];
  productRows: string[];
  name: string[];
  unit: string[];
  price: string[];
}

export interface SupplierCartSelectorConfig {
  addButton: string[];
  quantityInput: string[];
  productLink: string[];
}

export interface ApiSearchConfig {
  url: string | ((query: string) => string);
  method?: "GET" | "POST";
  queryParam?: string;
  headers?: Record<string, string>;
  body?: (query: string) => BodyInit | null;
}

export interface DomSupplierConfig {
  id: SupplierId;
  name: string;
  startUrl: string;
  loginUrl?: string;
  selectors: SupplierSelectorConfig;
  cartSelectors?: Partial<SupplierCartSelectorConfig>;
  htmlSearchUrl?: string | ((query: string) => string);
  apiSearchConfigs?: ApiSearchConfig[];
}

export class SupplierDomError extends Error {
  readonly diagnostic: DomDiagnostic;

  constructor(message: string, diagnostic: DomDiagnostic) {
    super(message);
    this.name = "SupplierDomError";
    this.diagnostic = diagnostic;
  }
}

export function createDomSupplierAdapter(config: DomSupplierConfig): SupplierAdapter {
  return {
    id: config.id,
    name: config.name,
    startUrl: config.startUrl,
    loginUrl: config.loginUrl,
    detectLoginState: () => detectLoginState(config),
    search: async (query, options) => {
      throwIfAborted(options.signal);
      const maxPages = options.maxPages ?? 10;
      const delayMs = options.delayMs ?? 700;

      const apiResults = await tryConfiguredApiSearch(config, query, options.signal);
      if (apiResults) {
        return apiResults;
      }

      const htmlResults = await tryConfiguredHtmlSearch(config, query, {
        signal: options.signal,
        maxPages,
        delayMs
      });
      if (htmlResults) {
        return htmlResults;
      }

      return performDomSearch(config, query, {
        signal: options.signal,
        maxPages,
        delayMs
      });
    },
    addToCart: async (item, options) => {
      throwIfAborted(options.signal);
      return addPurchaseItemToCart(config, item, {
        signal: options.signal,
        delayMs: options.delayMs ?? 700,
        maxPages: options.maxPages ?? 10
      });
    }
  };
}

async function detectLoginState(config: DomSupplierConfig): Promise<{ loggedIn: boolean; reason?: string }> {
  const url = location.href.toLocaleLowerCase("ru-RU");
  const pageText = normalizeWhitespace(document.body?.innerText ?? "").toLocaleLowerCase("ru-RU");
  const hasPasswordInput = Boolean(document.querySelector('input[type="password"]'));
  const hasAccountMarker = /(выйти|личный кабинет|профиль|аккаунт|мой кабинет)/iu.test(pageText);
  const hasLoginMarker = /(войти|авторизация|логин|sign in|login)/iu.test(pageText);

  if (config.id === "smartpro" && isSmartProLoggedOutPage(url, pageText)) {
    return {
      loggedIn: false,
      reason: "SmartPro открыл публичную страницу без авторизованного маркетплейса."
    };
  }

  if (config.id === "metro" && isMetroLoggedOutPage(url, pageText, hasPasswordInput, hasAccountMarker)) {
    return {
      loggedIn: false,
      reason: "METRO открыт без авторизованной пользовательской сессии."
    };
  }

  if (url.includes("login") || url.includes("auth") || hasPasswordInput) {
    return {
      loggedIn: false,
      reason: "Найдена страница или форма авторизации."
    };
  }

  if (hasLoginMarker && !hasAccountMarker && !findVisibleSearchInput(config)) {
    return {
      loggedIn: false,
      reason: "На странице есть признаки неавторизованного состояния."
    };
  }

  return {
    loggedIn: true,
    reason: "Форма входа не обнаружена; доступность поиска будет проверена при запуске."
  };
}

async function tryConfiguredApiSearch(
  config: DomSupplierConfig,
  query: string,
  signal?: AbortSignal
): Promise<SupplierSearchResult[] | null> {
  const apiConfigs = config.apiSearchConfigs ?? [];
  if (apiConfigs.length === 0) {
    return null;
  }

  for (const apiConfig of apiConfigs) {
    throwIfAborted(signal);
    try {
      const url = buildApiUrl(apiConfig, query);
      const response = await fetch(url, {
        method: apiConfig.method ?? "GET",
        headers: apiConfig.headers,
        body: apiConfig.body?.(query) ?? undefined,
        credentials: "include",
        signal
      });

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as unknown;
      return mapGenericApiResults(payload, config, query);
    } catch {
      continue;
    }
  }

  return null;
}

async function tryConfiguredHtmlSearch(
  config: DomSupplierConfig,
  query: string,
  options: { signal?: AbortSignal; maxPages: number; delayMs: number }
): Promise<SupplierSearchResult[] | null> {
  if (!config.htmlSearchUrl) {
    return null;
  }

  const results: SupplierSearchResult[] = [];
  const seenUrls = new Set<string>();
  let nextUrl = buildConfiguredUrl(config.htmlSearchUrl, query);

  for (let pageNumber = 1; pageNumber <= options.maxPages && nextUrl; pageNumber += 1) {
    throwIfAborted(options.signal);

    if (seenUrls.has(nextUrl)) {
      break;
    }
    seenUrls.add(nextUrl);

    try {
      const response = await fetch(nextUrl, {
        credentials: "include",
        signal: options.signal
      });

      if (!response.ok) {
        return pageNumber === 1 ? null : dedupeResults(results);
      }

      const html = await response.text();
      const parsedDocument = new DOMParser().parseFromString(html, "text/html");
      addDocumentBase(parsedDocument, nextUrl);
      results.push(...parseProductsFromRoot(config, query, parsedDocument, { requireVisible: false }));

      const nextPage = findNextPageElement(parsedDocument, false);
      const href = nextPage?.getAttribute("href");
      if (!href) {
        break;
      }

      nextUrl = new URL(href, nextUrl).toString();
      if (pageNumber < options.maxPages) {
        await sleep(options.delayMs, options.signal);
      }
    } catch {
      return pageNumber === 1 ? null : dedupeResults(results);
    }
  }

  return dedupeResults(results);
}

function buildConfiguredUrl(
  urlConfig: string | ((query: string) => string),
  query: string
): string {
  const rawUrl = typeof urlConfig === "function" ? urlConfig(query) : urlConfig;
  return new URL(rawUrl, location.origin).toString();
}

function addDocumentBase(parsedDocument: Document, href: string): void {
  const base = parsedDocument.createElement("base");
  base.href = href;
  parsedDocument.head?.prepend(base);
}

function buildApiUrl(apiConfig: ApiSearchConfig, query: string): string {
  const rawUrl = typeof apiConfig.url === "function" ? apiConfig.url(query) : apiConfig.url;
  const url = new URL(rawUrl, location.origin);

  if (apiConfig.queryParam) {
    url.searchParams.set(apiConfig.queryParam, query);
  }

  return url.toString();
}

function mapGenericApiResults(
  payload: unknown,
  config: DomSupplierConfig,
  query: string
): SupplierSearchResult[] {
  const rows = findFirstArray(payload);
  if (!rows) {
    return [];
  }

  const mapped: Array<SupplierSearchResult | null> = rows.map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }

      const objectRow = row as Record<string, unknown>;
      const name = readObjectString(objectRow, ["name", "title", "productName", "product_name", "Наименование"]);
      const rawUnit = readObjectString(objectRow, ["unit", "package", "packing", "measure", "Единица", "Упаковка"]);
      const rawPrice = readObjectString(objectRow, ["price", "cost", "amount", "Цена"]);
      const url = readObjectString(objectRow, ["url", "href", "link"]);
      const price = rawPrice || extractPrice(JSON.stringify(objectRow));
      const unitOrPackage = extractUnitFromPrice(price) || rawUnit || extractUnitOrPackage(name);

      if (!name || !price) {
        return null;
      }

      const result: SupplierSearchResult = {
        supplierId: config.id,
        supplierName: config.name,
        sourceQuery: query,
        name,
        unitOrPackage,
        price,
        normalizedPrice: parseNormalizedPrice(price),
        url: url ? new URL(url, location.origin).toString() : undefined,
        scrapedAt: new Date().toISOString()
      };
      return result;
    });

  return mapped.filter((result): result is SupplierSearchResult => result !== null);
}

function findFirstArray(value: unknown, depth = 0): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== "object" || depth > 4) {
    return null;
  }

  const objectValue = value as Record<string, unknown>;
  const preferredKeys = ["items", "products", "results", "data", "rows"];
  for (const key of preferredKeys) {
    const nested = objectValue[key];
    if (Array.isArray(nested)) {
      return nested;
    }
  }

  for (const nested of Object.values(objectValue)) {
    const found = findFirstArray(nested, depth + 1);
    if (found) {
      return found;
    }
  }

  return null;
}

function readObjectString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" || typeof value === "number") {
      return normalizeWhitespace(String(value));
    }
  }
  return "";
}

async function performDomSearch(
  config: DomSupplierConfig,
  query: string,
  options: { signal?: AbortSignal; maxPages: number; delayMs: number }
): Promise<SupplierSearchResult[]> {
  if (!(await waitForCurrentSearchPageResults(config, query, options.signal))) {
    await waitForSupplierUiReady(config, options.signal);

    let searchInput = findVisibleSearchInput(config);
    if (!searchInput || !isVisible(searchInput)) {
      throw createDomError(config, "Не найдено доступное поле поиска.");
    }

    searchInput = await activateSearchInput(config, searchInput, options.signal);
    const initialSignature = getPageSignature(config);
    setInputValue(searchInput, query);
    submitSearch(searchInput);

    if (config.id === "smartpro") {
      await waitForSmartProSearchSettled(config, query, options.signal);
    } else {
      await waitForSearchReaction(config, initialSignature, options.signal);
    }
  }
  await sleep(options.delayMs, options.signal);

  const results: SupplierSearchResult[] = [];
  const seenPages = new Set<string>();

  for (let pageNumber = 1; pageNumber <= options.maxPages; pageNumber += 1) {
    throwIfAborted(options.signal);

    const pageSignature = getPageSignature(config);
    if (seenPages.has(pageSignature)) {
      break;
    }
    seenPages.add(pageSignature);

    results.push(...parseCurrentPage(config, query));

    if (pageNumber >= options.maxPages || !(await advanceToMoreResults(config, pageSignature, options.signal))) {
      break;
    }
    await sleep(options.delayMs, options.signal);
  }

  return dedupeResults(results);
}

async function addPurchaseItemToCart(
  config: DomSupplierConfig,
  item: PurchaseUploadItem,
  options: { signal?: AbortSignal; delayMs: number; maxPages: number }
): Promise<SupplierCartResult> {
  if (!item.price) {
    return {
      supplierId: config.id,
      supplierName: config.name,
      sourceName: item.name,
      requestedQuantity: item.quantity,
      requestedPrice: item.price,
      status: "not_found",
      message: "В строке файла нет цены. Добавление в корзину заблокировано.",
      completedAt: new Date().toISOString()
    };
  }

  await performCartSearch(config, item.name, options);

  const { closestByName, productElement } = await findCartProductAcrossPages(config, item, options);
  if (!productElement) {
    const closestPrice = closestByName ? getProductPriceForCart(config, closestByName) : "";
    return {
      supplierId: config.id,
      supplierName: config.name,
      sourceName: item.name,
      requestedQuantity: item.quantity,
      requestedPrice: item.price,
      matchedName: closestByName ? getProductNameForCart(config, closestByName) : undefined,
      matchedPrice: closestPrice || undefined,
      status: "not_found",
      message: closestByName
        ? `Цена не совпала: в файле ${item.price}, на сайте ${closestPrice || "не найдена"}.`
        : "Товар с совпадающим названием и ценой не найден в выдаче поставщика.",
      completedAt: new Date().toISOString()
    };
  }

  let matchedName = getProductNameForCart(config, productElement);
  let matchedPrice = getProductPriceForCart(config, productElement);
  let activeRoot: ParentNode = productElement;
  let addButton = findAddToCartButton(config, activeRoot);

  if (!addButton) {
    const productLink = findProductLink(config, productElement, item.name);
    if (productLink) {
      const previousUrl = location.href;
      clickElement(productLink);
      await waitForProductNavigation(config, previousUrl, options.signal);
      await sleep(options.delayMs, options.signal);
      activeRoot = document;
      const detailElement = document.documentElement;
      const detailName = getProductNameForCart(config, detailElement) || matchedName;
      const detailPrice = getProductPriceForCart(config, detailElement) || matchedPrice;
      if (!isNameMatch(detailName, item.name) || !isPriceMatch(detailPrice, item.price)) {
        return {
          supplierId: config.id,
          supplierName: config.name,
          sourceName: item.name,
          requestedQuantity: item.quantity,
          requestedPrice: item.price,
          matchedName: detailName || undefined,
          matchedPrice: detailPrice || undefined,
          status: "not_found",
          message: `После открытия карточки название или цена не совпали: "${detailName || "без названия"}", цена ${detailPrice || "не найдена"}.`,
          completedAt: new Date().toISOString()
        };
      }
      matchedName = detailName;
      matchedPrice = detailPrice;
      addButton = findAddToCartButton(config, activeRoot);
    }
  }

  if (!addButton) {
    throw createDomError(config, `Не найдена кнопка добавления в корзину для "${item.name}".`);
  }

  const previousCartIndicatorText = getCartIndicatorText();
  clickElement(addButton);
  const addConfirmation = await waitForCartAddConfirmation(
    config,
    addButton,
    activeRoot,
    previousCartIndicatorText,
    options.signal
  );
  if (!addConfirmation.confirmed) {
    return {
      supplierId: config.id,
      supplierName: config.name,
      sourceName: item.name,
      requestedQuantity: item.quantity,
      requestedPrice: item.price,
      matchedName,
      matchedPrice,
      status: "error",
      message: addConfirmation.message,
      url: getClosestUrl(productElement) || location.href,
      completedAt: new Date().toISOString()
    };
  }

  const quantitySet = await setRequestedQuantity(config, item.quantity, activeRoot, options.signal);
  if (!quantitySet) {
    throw createDomError(config, `Товар добавлен, но не удалось выставить количество "${item.quantity}" для "${item.name}".`);
  }

  return {
    supplierId: config.id,
    supplierName: config.name,
    sourceName: item.name,
    requestedQuantity: item.quantity,
    requestedPrice: item.price,
    matchedName,
    matchedPrice,
    status: "added",
    url: getClosestUrl(productElement) || location.href,
    completedAt: new Date().toISOString()
  };
}

async function findCartProductAcrossPages(
  config: DomSupplierConfig,
  item: PurchaseUploadItem,
  options: { signal?: AbortSignal; delayMs: number; maxPages: number }
): Promise<{ closestByName: Element | null; productElement: Element | null }> {
  const seenPages = new Set<string>();
  let closestByName: Element | null = null;

  for (let pageNumber = 1; pageNumber <= options.maxPages; pageNumber += 1) {
    throwIfAborted(options.signal);

    const pageSignature = getPageSignature(config);
    if (seenPages.has(pageSignature)) {
      break;
    }
    seenPages.add(pageSignature);

    closestByName = closestByName ?? findBestProductElement(config, item.name);
    const productElement = findBestProductElement(config, item.name, item.price);
    if (productElement) {
      return {
        closestByName: closestByName ?? productElement,
        productElement
      };
    }

    if (pageNumber >= options.maxPages || !(await advanceToMoreResults(config, pageSignature, options.signal))) {
      break;
    }
    await sleep(options.delayMs, options.signal);
  }

  return {
    closestByName,
    productElement: null
  };
}

async function performCartSearch(
  config: DomSupplierConfig,
  query: string,
  options: { signal?: AbortSignal; delayMs: number }
): Promise<void> {
  if (await waitForCurrentSearchPageResults(config, query, options.signal)) {
    await sleep(options.delayMs, options.signal);
    return;
  }

  await waitForSupplierUiReady(config, options.signal);

  let searchInput = findVisibleSearchInput(config);
  if (!searchInput || !isVisible(searchInput)) {
    throw createDomError(config, "Не найдено доступное поле поиска для загрузки закупки.");
  }

  searchInput = await activateSearchInput(config, searchInput, options.signal);
  const initialSignature = getPageSignature(config);
  setInputValue(searchInput, query);
  submitSearch(searchInput);

  if (config.id === "smartpro") {
    await waitForSmartProSearchSettled(config, query, options.signal);
  } else {
    await waitForSearchReaction(config, initialSignature, options.signal);
  }

  await sleep(options.delayMs, options.signal);
}

function submitSearch(input: HTMLInputElement | HTMLTextAreaElement): void {
  const form = input.closest("form");
  const submitButton = form
    ? queryFirst<HTMLElement>(
        ["button[type='submit']", "input[type='submit']", "button:not([type])"],
        form
      )
    : null;

  if (submitButton && isVisible(submitButton) && !isDisabled(submitButton)) {
    clickElement(submitButton);
    return;
  }

  const nearbySearchButton = findClickableByText(["найти", "поиск", "искать"]);
  if (nearbySearchButton) {
    clickElement(nearbySearchButton);
    return;
  }

  pressEnter(input);
}

async function waitForSearchReaction(
  config: DomSupplierConfig,
  initialSignature: string,
  signal?: AbortSignal
): Promise<void> {
  try {
    await waitFor(
      () =>
        getPageSignature(config) !== initialSignature ||
        hasNoResultsText(),
      { timeoutMs: 10000, intervalMs: 250, signal }
    );
  } catch {
    // Some supplier UIs render results synchronously or keep URL/text signatures stable.
  }
}

async function waitForCurrentSearchPageResults(
  config: DomSupplierConfig,
  query: string,
  signal?: AbortSignal
): Promise<boolean> {
  if (!isCurrentSearchPageForQuery(config, query)) {
    return false;
  }

  try {
    await waitFor(
      () => collectProductElements(config).some(isVisible) || hasNoResultsText(),
      { timeoutMs: 30000, intervalMs: 300, signal }
    );
  } catch {
    throw createDomError(config, `${config.name} не завершил загрузку страницы поиска по запросу "${query}".`);
  }

  return true;
}

function isCurrentSearchPageForQuery(config: DomSupplierConfig, query: string): boolean {
  if (config.id !== "metro") {
    return false;
  }

  try {
    const parsed = new URL(location.href);
    const isSearchPath = parsed.pathname === "/search" || parsed.pathname === "/search/";
    return isSearchPath && normalizeSearchQuery(parsed.searchParams.get("q") ?? "") === normalizeSearchQuery(query);
  } catch {
    return false;
  }
}

function normalizeSearchQuery(value: string): string {
  return normalizeWhitespace(value).toLocaleLowerCase("ru-RU");
}

async function waitForPageChange(
  config: DomSupplierConfig,
  initialSignature: string,
  signal?: AbortSignal
): Promise<void> {
  try {
    await waitFor(() => getPageSignature(config) !== initialSignature, {
      timeoutMs: 10000,
      intervalMs: 300,
      signal
    });
  } catch {
    // If pagination updates in-place without a stable marker, parse the current DOM after the delay.
  }
}

function parseCurrentPage(config: DomSupplierConfig, query: string): SupplierSearchResult[] {
  return parseProductsFromRoot(config, query, document, { requireVisible: true });
}

function parseProductsFromRoot(
  config: DomSupplierConfig,
  query: string,
  root: ParentNode,
  options: { requireVisible: boolean }
): SupplierSearchResult[] {
  const rows = collectProductElements(config, root).filter(
    (element) => !options.requireVisible || isVisible(element)
  );
  const results: SupplierSearchResult[] = [];

  for (const row of rows) {
    const parsed = parseProductElement(config, query, row);
    if (parsed) {
      results.push(parsed);
    }
  }

  return dedupeResults(results);
}

function collectProductElements(config: DomSupplierConfig, root: ParentNode = document): Element[] {
  const configuredRows = filterNestedElements(queryAllUnique<Element>(config.selectors.productRows, root));
  if (configuredRows.length > 0) {
    return configuredRows;
  }

  return filterNestedElements(
    queryAllUnique<Element>(
      [
        "article",
        "[class*='product']",
        "[class*='catalog'] [class*='item']",
        "[class*='market'] [class*='item']",
        "table tbody tr"
      ],
      root
    )
  );
}

function parseProductElement(
  config: DomSupplierConfig,
  query: string,
  element: Element
): SupplierSearchResult | null {
  const fullText = getText(element);
  const url = getClosestUrl(element);
  const explicitName = readFirstText(element, config.selectors.name);
  const explicitUnit = readFirstText(element, config.selectors.unit);
  const explicitPrice = readFirstText(element, config.selectors.price);

  if (
    fullText.length < 3 ||
    (fullText.length > 3000 && (!explicitName || !explicitPrice)) ||
    looksLikeHeader(fullText) ||
    shouldSkipProductElement(config, element, fullText, url)
  ) {
    return null;
  }

  const price = explicitPrice || extractPrice(fullText);
  const unitOrPackage =
    extractUnitFromPrice(explicitPrice || price) ||
    explicitUnit ||
    extractUnitOrPackage(explicitName);
  const name = inferName(element, explicitName, price, unitOrPackage);

  if (!name || !price || looksLikeNoiseName(name)) {
    return null;
  }

  return {
    supplierId: config.id,
    supplierName: config.name,
    sourceQuery: query,
    name,
    unitOrPackage,
    price,
    normalizedPrice: parseNormalizedPrice(price),
    url: url || undefined,
    scrapedAt: new Date().toISOString()
  };
}

function findBestProductElement(config: DomSupplierConfig, query: string, expectedPrice?: string): Element | null {
  const rows = collectProductElements(config).filter(isVisible);
  if (rows.length === 0) {
    return null;
  }

  const scored = rows
    .map((row, index) => {
      const name = getProductNameForCart(config, row) || getText(row);
      const price = getProductPriceForCart(config, row);
      const nameScore = scoreProductMatch(name, query);
      const nameMatches = isNameMatch(name, query);
      const priceMatches = expectedPrice ? isPriceMatch(price, expectedPrice) : true;
      return {
        row,
        index,
        score: nameMatches && priceMatches ? nameScore : 0
      };
    })
    .filter((candidate) => candidate.score > 0);

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.row ?? null;
}

function getProductNameForCart(config: DomSupplierConfig, element: Element): string {
  const explicitName = readFirstText(element, config.selectors.name);
  const fullText = getText(element);
  const price = readFirstText(element, config.selectors.price) || extractPrice(fullText);
  const unit = readFirstText(element, config.selectors.unit) || extractUnitFromPrice(price) || extractUnitOrPackage(explicitName);
  return inferName(element, explicitName, price, unit);
}

function getProductPriceForCart(config: DomSupplierConfig, element: Element): string {
  return readFirstText(element, config.selectors.price) || extractPrice(getText(element));
}

function scoreProductMatch(name: string, query: string): number {
  const normalizedName = normalizeForMatch(name);
  const normalizedQuery = normalizeForMatch(query);
  if (!normalizedName || !normalizedQuery) {
    return 0;
  }

  if (normalizedName === normalizedQuery) {
    return 1000;
  }

  if (isNameMatch(name, query)) {
    return 700;
  }

  const queryTokens = normalizedQuery.split(" ").filter((token) => token.length > 1);
  if (queryTokens.length === 0) {
    return 0;
  }

  const matchedTokens = queryTokens.filter((token) => normalizedName.includes(token)).length;
  return Math.round((matchedTokens / queryTokens.length) * 500);
}

function isNameMatch(name: string, query: string): boolean {
  const normalizedName = normalizeForMatch(name);
  const normalizedQuery = normalizeForMatch(query);
  return Boolean(
    normalizedName &&
      normalizedQuery &&
      (normalizedName === normalizedQuery ||
        normalizedName.includes(normalizedQuery) ||
        normalizedQuery.includes(normalizedName))
  );
}

function isPriceMatch(actualPrice: string, expectedPrice: string): boolean {
  const actual = parseNormalizedPrice(actualPrice);
  const expected = parseNormalizedPrice(expectedPrice);
  return actual != null && expected != null && Math.abs(actual - expected) < 0.01;
}

function readFirstText(root: Element, selectors: string[]): string {
  for (const selector of selectors) {
    const text = getText(queryFirst(selector.split(",").length > 1 ? [selector] : [selector], root));
    if (text) {
      return text;
    }
  }
  return "";
}

function inferName(element: Element, explicitName: string, price: string, unit: string): string {
  const cleanedExplicit = cleanName(explicitName, price, unit);
  if (cleanedExplicit) {
    return cleanedExplicit;
  }

  const fragments = queryAllUnique<Element>(
    [
      "[data-testid*='name']",
      "[data-testid*='title']",
      ".product-name",
      ".name",
      ".title",
      "a[href]",
      "h1",
      "h2",
      "h3",
      "h4",
      "td"
    ],
    element
  )
    .map(getText)
    .map((text) => cleanName(text, price, unit))
    .filter(Boolean)
    .filter((text) => !looksLikeControlText(text))
    .filter((text) => !looksLikeNoiseName(text))
    .filter((text) => !looksLikePriceOnly(text));

  fragments.sort((a, b) => b.length - a.length);
  if (fragments[0]) {
    return fragments[0].slice(0, 250);
  }

  return cleanName(getText(element), price, unit).slice(0, 250);
}

function cleanName(value: string, price: string, unit: string): string {
  let text = normalizeWhitespace(value);
  if (!text) {
    return "";
  }

  for (const part of [price, unit]) {
    if (part) {
      text = text.replace(new RegExp(escapeRegExp(part), "iu"), " ");
    }
  }

  return normalizeWhitespace(text);
}

function looksLikeHeader(text: string): boolean {
  const lowerText = text.toLocaleLowerCase("ru-RU");
  return lowerText.includes("наименование") && lowerText.includes("цена") && !extractPrice(text);
}

function looksLikeControlText(text: string): boolean {
  return /^(в корзину|купить|подробнее|сравнить|избранное|наличие|остаток|цена|кол-во|количество|артикул|код)$/iu.test(text);
}

function looksLikePriceOnly(text: string): boolean {
  const price = extractPrice(text);
  return Boolean(price && normalizeWhitespace(text.replace(price, "")) === "");
}

function looksLikeNoiseName(text: string): boolean {
  const normalized = normalizeWhitespace(text);
  const lowerText = normalized.toLocaleLowerCase("ru-RU");
  return (
    normalized.length < 2 ||
    /^[/\\.,;:\-\s]+$/u.test(normalized) ||
    /^(мая|июня|июля|наличие|характеристики)$/iu.test(normalized) ||
    lowerText.startsWith("минимальный заказ") ||
    lowerText.includes("с этим товаром покупают") ||
    lowerText.includes("похожие товары")
  );
}

function shouldSkipProductElement(
  config: DomSupplierConfig,
  element: Element,
  fullText: string,
  url: string
): boolean {
  if (looksLikeNoiseName(fullText)) {
    return true;
  }

  if (url && isRejectedProductUrl(url)) {
    return true;
  }

  if (config.id === "gfc") {
    return !isGfcCatalogProduct(config, element, url);
  }

  if (config.id === "metro") {
    return !isMetroProduct(config, element, url);
  }

  return false;
}

function isRejectedProductUrl(rawUrl: string): boolean {
  try {
    const parsedUrl = new URL(rawUrl, location.origin);
    return parsedUrl.searchParams.has("slider_name") || parsedUrl.searchParams.get("view_type") === "carousel";
  } catch {
    return false;
  }
}

function isGfcCatalogProduct(config: DomSupplierConfig, element: Element, rawUrl: string): boolean {
  if (config.id !== "gfc") {
    return false;
  }

  const hasCatalogCardMarker = hasGfcCatalogProductMarker(element);
  if (!rawUrl) {
    return hasCatalogCardMarker;
  }

  if (!hasCatalogCardMarker) {
    return false;
  }

  try {
    const parsedUrl = new URL(rawUrl, location.origin);
    const viewType = parsedUrl.searchParams.get("view_type");
    return (
      parsedUrl.hostname.endsWith("gfc-russia.ru") &&
      parsedUrl.pathname.startsWith("/catalog/") &&
      !parsedUrl.pathname.startsWith("/catalog/brend-") &&
      (!viewType || viewType === "catalog")
    );
  } catch {
    return false;
  }
}

function hasGfcCatalogProductMarker(element: Element): boolean {
  return (
    element.matches("[data-cy='catalog-product'], .catalog-product") ||
    Boolean(element.querySelector("[data-cy='catalog-product'], .catalog-product, [data-pw='catalog-price']"))
  );
}

function isMetroProduct(config: DomSupplierConfig, element: Element, rawUrl: string): boolean {
  if (config.id !== "metro") {
    return false;
  }

  const productLink =
    (element.matches('a[href*="/products/"]') ? (element as HTMLAnchorElement) : null) ??
    element.querySelector<HTMLAnchorElement>('a[href*="/products/"]');
  const productUrl = rawUrl || productLink?.href || "";
  if (!productUrl) {
    return false;
  }

  try {
    const parsedUrl = new URL(productUrl, location.origin);
    return parsedUrl.hostname.endsWith("metro-cc.ru") && parsedUrl.pathname.startsWith("/products/");
  } catch {
    return false;
  }
}

function findNextPageElement(root: ParentNode = document, requireVisible = true): HTMLElement | null {
  const selectorMatches = queryAllUnique<HTMLElement>([
    "nav a[rel='next']",
    "[class*='pagination'] a[rel='next']",
    "[class*='pagination'] .pagination-next",
    "[class*='pagination'] .pager-next",
    "[class*='pagination'] button.next",
    "[class*='pagination'] a.next",
    "[class*='pagination'] [aria-label*='След']",
    "[class*='pagination'] [aria-label*='след']",
    "[class*='pagination'] [aria-label*='Next']"
  ], root).filter((element) => (!requireVisible || isVisible(element)) && !isDisabled(element));

  if (selectorMatches[0]) {
    return selectorMatches[0];
  }

  if (!requireVisible) {
    return null;
  }

  const paginationRoot = queryFirst<HTMLElement>(
    ["nav[class*='pagination']", "[class*='pagination']", "[data-testid*='pagination']"],
    root
  );

  return paginationRoot ? findClickableByText(["следующая", "далее", "next"], paginationRoot) : null;
}

async function advanceToMoreResults(
  config: DomSupplierConfig,
  currentSignature: string,
  signal?: AbortSignal
): Promise<boolean> {
  const nextPage = findNextPageElement();
  if (nextPage) {
    clickElement(nextPage);
    await waitForPageChange(config, currentSignature, signal);
    return getPageSignature(config) !== currentSignature;
  }

  return scrollForMoreResults(config, currentSignature, signal);
}

async function scrollForMoreResults(
  config: DomSupplierConfig,
  currentSignature: string,
  signal?: AbortSignal
): Promise<boolean> {
  const beforeCount = collectProductElements(config).length;
  const beforeScrollY = window.scrollY;
  const targetScrollTop = Math.max(
    document.documentElement.scrollHeight,
    document.body?.scrollHeight ?? 0
  );

  window.scrollTo(0, targetScrollTop);

  try {
    await waitFor(
      () =>
        getPageSignature(config) !== currentSignature ||
        collectProductElements(config).length > beforeCount ||
        window.scrollY !== beforeScrollY,
      { timeoutMs: 5000, intervalMs: 250, signal }
    );
  } catch {
    return false;
  }

  return getPageSignature(config) !== currentSignature || collectProductElements(config).length > beforeCount;
}

function findAddToCartButton(config: DomSupplierConfig, root: ParentNode): HTMLElement | null {
  const selectors = getCartSelectors(config).addButton;
  const candidates = queryAllUnique<HTMLElement>(selectors, root)
    .filter((element) => isVisible(element) && !isDisabled(element))
    .map((element, index) => ({
      element,
      index,
      score: scoreCartButton(element)
    }))
    .filter((candidate) => candidate.score > 0);

  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0]?.element ?? null;
}

function findProductLink(config: DomSupplierConfig, root: ParentNode, query: string): HTMLAnchorElement | null {
  const selectors = getCartSelectors(config).productLink;
  const links = queryAllUnique<HTMLAnchorElement>(selectors, root)
    .filter((link) => isVisible(link) && Boolean(link.href) && !link.href.startsWith("javascript:"))
    .map((link, index) => ({
      link,
      index,
      score: scoreProductMatch(getText(link), query)
    }))
    .filter((candidate) => !isRejectedProductUrl(candidate.link.href));

  links.sort((a, b) => b.score - a.score || a.index - b.index);
  return links[0]?.link ?? null;
}

async function waitForProductNavigation(
  config: DomSupplierConfig,
  previousUrl: string,
  signal?: AbortSignal
): Promise<void> {
  try {
    await waitFor(
      () =>
        location.href !== previousUrl ||
        Boolean(findAddToCartButton(config, document)) ||
        collectProductElements(config).some(isVisible),
      { timeoutMs: 12000, intervalMs: 250, signal }
    );
  } catch {
    // The add-button lookup below will provide a specific diagnostic.
  }
}

async function waitForCartAddConfirmation(
  config: DomSupplierConfig,
  addButton: HTMLElement,
  preferredRoot: ParentNode,
  previousCartIndicatorText: string,
  signal?: AbortSignal
): Promise<{ confirmed: boolean; message: string }> {
  const roots = preferredRoot === document ? [document] : [preferredRoot, document];

  try {
    const result = await waitFor(
      () => {
        const blockingMessage = detectCartBlockingPrompt(config);
        if (blockingMessage) {
          return { confirmed: false, message: blockingMessage };
        }

        if (findQuantityInput(config, roots) || hasQuantityControl(roots)) {
          return { confirmed: true, message: "" };
        }

        if (!document.contains(addButton) || !isVisible(addButton)) {
          return { confirmed: true, message: "" };
        }

        const currentCartIndicatorText = getCartIndicatorText();
        if (currentCartIndicatorText && currentCartIndicatorText !== previousCartIndicatorText) {
          return { confirmed: true, message: "" };
        }

        return null;
      },
      { timeoutMs: 8000, intervalMs: 250, signal }
    );
    return result as { confirmed: boolean; message: string };
  } catch {
    const blockingMessage = detectCartBlockingPrompt(config);
    return {
      confirmed: false,
      message:
        blockingMessage ||
        `После клика по кнопке корзины ${config.name} не подтвердил добавление товара. Проверьте, не требуется ли на сайте выбрать адрес, торговую точку или условия заказа.`
    };
  }
}

function detectCartBlockingPrompt(config: DomSupplierConfig): string {
  const pageText = normalizeWhitespace(document.body?.innerText ?? "").toLocaleLowerCase("ru-RU");

  if (config.id === "metro" && /(укажите адрес|адрес нужен|выберите адрес|выберите магазин|выберите способ получения)/iu.test(pageText)) {
    return "METRO запросил адрес доставки или магазин самовывоза. Откройте METRO, выберите адрес/магазин и запустите загрузку закупки повторно.";
  }

  if (
    config.id === "smartpro" &&
    /(выберите|укажите|заполните).{0,80}(организац|торгов|точк|поставщик|склад|адрес)/iu.test(pageText)
  ) {
    return "SmartPro запросил выбор организации, торговой точки, поставщика или адреса. Откройте SmartPro, заполните этот выбор и запустите загрузку повторно.";
  }

  if (/(войдите|авторизуйтесь|требуется авторизация|необходимо авторизоваться)/iu.test(pageText)) {
    return `${config.name} запросил авторизацию перед добавлением в корзину.`;
  }

  return "";
}

async function setRequestedQuantity(
  config: DomSupplierConfig,
  quantity: string,
  preferredRoot: ParentNode,
  signal?: AbortSignal
): Promise<boolean> {
  const normalizedQuantity = normalizeQuantityForInput(quantity);
  const targetQuantity = parseQuantityNumber(normalizedQuantity);
  const quantityIsDefault = targetQuantity === 1;
  const roots = preferredRoot === document ? [document] : [preferredRoot, document];

  for (let attempt = 0; attempt < 12; attempt += 1) {
    throwIfAborted(signal);

    const input = findQuantityInput(config, roots);
    if (input) {
      setInputValue(input, normalizedQuantity);
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter", code: "Enter" }));
      input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter", code: "Enter" }));
      input.blur();
      await sleep(150, signal);
      return true;
    }

    if (await setQuantityWithStepper(config, roots, targetQuantity, signal)) {
      return true;
    }

    if (quantityIsDefault && attempt >= 2) {
      return true;
    }

    await sleep(250, signal);
  }

  return false;
}

async function setQuantityWithStepper(
  config: DomSupplierConfig,
  roots: ParentNode[],
  targetQuantity: number | null,
  signal?: AbortSignal
): Promise<boolean> {
  if (targetQuantity == null || targetQuantity <= 0 || !Number.isInteger(targetQuantity)) {
    return false;
  }

  const currentQuantity = readVisibleQuantity(config, roots) ?? 1;
  if (currentQuantity === targetQuantity) {
    return true;
  }

  const direction = targetQuantity > currentQuantity ? "increment" : "decrement";
  const stepButton = findQuantityStepButton(config, roots, direction);
  if (!stepButton) {
    return false;
  }

  const clicks = Math.min(Math.abs(targetQuantity - currentQuantity), 50);
  for (let index = 0; index < clicks; index += 1) {
    throwIfAborted(signal);
    clickElement(stepButton);
    await sleep(200, signal);
  }

  return true;
}

function findQuantityInput(config: DomSupplierConfig, roots: ParentNode[]): HTMLInputElement | null {
  const selectors = getCartSelectors(config).quantityInput;
  const seen = new Set<HTMLInputElement>();
  const candidates: Array<{ input: HTMLInputElement; index: number; score: number }> = [];

  for (const root of roots) {
    for (const input of queryAllUnique<HTMLInputElement>(selectors, root)) {
      if (seen.has(input)) {
        continue;
      }
      seen.add(input);

      if (!isVisible(input) || isDisabled(input) || isSearchLikeInput(input)) {
        continue;
      }

      const score = scoreQuantityInput(input, root !== document);
      if (score > 0) {
        candidates.push({ input, index: candidates.length, score });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0]?.input ?? null;
}

function hasQuantityControl(roots: ParentNode[]): boolean {
  const selectors = [
    "[class*='counter']",
    "[class*='quantity']",
    "[class*='stepper']",
    "[class*='amount']",
    "[data-testid*='quantity']",
    "[data-test*='quantity']",
    "[data-qa*='quantity']",
    "[aria-label*='колич']",
    "[title*='колич']",
    "button[aria-label='+']",
    "button[aria-label='-']"
  ];

  return roots.some((root) =>
    queryAllUnique<HTMLElement>(selectors, root).some((element) => {
      if (!isVisible(element) || isDisabled(element)) {
        return false;
      }

      const descriptor = getElementDescriptor(element);
      return /(counter|quantity|qty|колич|кол-во|\+|-|\d+)/iu.test(descriptor);
    })
  );
}

function findQuantityStepButton(
  config: DomSupplierConfig,
  roots: ParentNode[],
  direction: "increment" | "decrement"
): HTMLElement | null {
  const selectors =
    direction === "increment"
      ? [
          'button[aria-label*="увелич"]',
          'button[title*="увелич"]',
          'button[aria-label*="плюс"]',
          'button[title*="плюс"]',
          'button[class*="plus"]',
          'button[class*="increment"]',
          'button[class*="increase"]',
          '[role="button"][class*="plus"]',
          '[role="button"][class*="increment"]',
          "button",
          '[role="button"]'
        ]
      : [
          'button[aria-label*="уменьш"]',
          'button[title*="уменьш"]',
          'button[aria-label*="минус"]',
          'button[title*="минус"]',
          'button[class*="minus"]',
          'button[class*="decrement"]',
          'button[class*="decrease"]',
          '[role="button"][class*="minus"]',
          '[role="button"][class*="decrement"]',
          "button",
          '[role="button"]'
        ];

  const seen = new Set<HTMLElement>();
  const candidates: Array<{ element: HTMLElement; index: number; score: number }> = [];

  for (const root of roots) {
    for (const element of queryAllUnique<HTMLElement>(selectors, root)) {
      if (seen.has(element)) {
        continue;
      }
      seen.add(element);

      if (!isVisible(element) || isDisabled(element)) {
        continue;
      }

      const score = scoreQuantityStepButton(config, element, direction, root !== document);
      if (score > 0) {
        candidates.push({ element, index: candidates.length, score });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0]?.element ?? null;
}

function scoreQuantityStepButton(
  config: DomSupplierConfig,
  element: HTMLElement,
  direction: "increment" | "decrement",
  preferredRoot: boolean
): number {
  const descriptor = getElementDescriptor(element);
  if (/(favorite|heart|избран|сравнен|compare|search|поиск|filter|sort)/iu.test(descriptor)) {
    return 0;
  }

  let score = 0;
  const exactText = getText(element);

  if (direction === "increment") {
    if (/^\+$/u.test(exactText)) {
      score += 120;
    }
    if (/(plus|increment|increase|увелич|плюс|\+)/iu.test(descriptor)) {
      score += 100;
    }
  } else {
    if (/^[−-]$/u.test(exactText)) {
      score += 120;
    }
    if (/(minus|decrement|decrease|уменьш|минус)/iu.test(descriptor)) {
      score += 100;
    }
  }

  if (/(counter|quantity|qty|amount|колич|кол-во)/iu.test(descriptor)) {
    score += 40;
  }

  if (config.id === "gfc" && /catalog-product-(inc|dec|plus|minus|quantity)/iu.test(descriptor)) {
    score += 60;
  }

  if (score > 0 && preferredRoot) {
    score += 20;
  }

  return score;
}

function readVisibleQuantity(config: DomSupplierConfig, roots: ParentNode[]): number | null {
  const input = findQuantityInput(config, roots);
  if (input) {
    return parseQuantityNumber(input.value);
  }

  const quantityTextElements = roots.flatMap((root) =>
    queryAllUnique<HTMLElement>(
      [
        "[class*='counter']",
        "[class*='quantity']",
        "[class*='stepper']",
        "[class*='amount']",
        "[data-testid*='quantity']",
        "[data-test*='quantity']",
        "[data-qa*='quantity']"
      ],
      root
    )
  );

  for (const element of quantityTextElements) {
    if (!isVisible(element)) {
      continue;
    }
    const match = getText(element).match(/^\s*(\d+)\s*$/u);
    const parsed = match?.[1] ? Number(match[1]) : null;
    if (parsed != null && Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
}

function getCartIndicatorText(): string {
  return normalizeWhitespace(
    queryAllUnique<HTMLElement>([
      '[data-qa="header-common-cart-button"]',
      '[data-testid*="cart"][data-testid*="button"]',
      '[data-test*="cart"][data-test*="button"]',
      '[class*="cart-button"]',
      '[class*="basket-button"]'
    ])
      .find((element) => isVisible(element) && !isDisabled(element))
      ?.textContent ?? ""
  );
}

function getCartSelectors(config: DomSupplierConfig): SupplierCartSelectorConfig {
  return {
    addButton: [
      ...(config.cartSelectors?.addButton ?? []),
      '[data-testid*="cart"]',
      '[data-test*="cart"]',
      '[data-cy*="cart"]',
      '[data-pw*="cart"]',
      '[class*="cart"]',
      '[class*="basket"]',
      '[aria-label*="корз"]',
      '[title*="корз"]',
      "button",
      '[role="button"]'
    ],
    quantityInput: [
      ...(config.cartSelectors?.quantityInput ?? []),
      'input[type="number"]',
      'input[inputmode="numeric"]',
      'input[inputmode="decimal"]',
      'input[name*="quantity"]',
      'input[name*="qty"]',
      'input[name*="count"]',
      'input[class*="quantity"]',
      'input[class*="qty"]',
      'input[class*="count"]',
      '[data-testid*="quantity"] input',
      '[data-test*="quantity"] input',
      '[class*="quantity"] input',
      '[class*="counter"] input'
    ],
    productLink: [
      ...(config.cartSelectors?.productLink ?? []),
      'a[href*="/catalog/"]',
      'a[href*="/product"]',
      "a[href]"
    ]
  };
}

function scoreCartButton(element: HTMLElement): number {
  const descriptor = getElementDescriptor(element);
  if (/(favorite|heart|избран|сравнен|compare)/iu.test(descriptor)) {
    return 0;
  }

  let score = 0;
  if (/(в корз|корзин|добав|заказ|купить|cart|basket)/iu.test(getText(element))) {
    score += 120;
  }
  if (/(cart|basket|add-to|add_to|to-cart|button-to-cart|product-add|catalog-product-add|order|корз)/iu.test(descriptor)) {
    score += 100;
  }
  if (score > 0 && element.tagName === "BUTTON") {
    score += 20;
  }
  if (score > 0 && element.querySelector("svg")) {
    score += 8;
  }

  return score;
}

function scoreQuantityInput(input: HTMLInputElement, preferredRoot: boolean): number {
  const descriptor = getElementDescriptor(input);
  let score = preferredRoot ? 20 : 0;

  if (input.type === "number") {
    score += 80;
  }
  if (/(quantity|qty|count|amount|counter|кол|kol)/iu.test(descriptor)) {
    score += 100;
  }
  if (/(numeric|decimal)/iu.test(input.inputMode)) {
    score += 30;
  }

  return score;
}

function isSearchLikeInput(input: HTMLInputElement): boolean {
  const descriptor = getElementDescriptor(input);
  return (
    input.type === "search" ||
    ["hidden", "password", "email", "tel", "file", "checkbox", "radio"].includes(input.type) ||
    /(search|поиск|phone|телефон|email|mail|password|парол|price|цена)/iu.test(descriptor)
  );
}

function getElementDescriptor(element: Element): string {
  const html = element as HTMLElement;
  return [
    getText(element),
    html.id,
    html.className,
    html.getAttribute("aria-label"),
    html.getAttribute("title"),
    ...Array.from(html.attributes)
      .filter((attribute) => attribute.name.startsWith("data-"))
      .map((attribute) => attribute.value)
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("ru-RU");
}

function normalizeQuantityForInput(value: string): string {
  const match = value.match(/\d+(?:[.,]\d+)?/u);
  return match ? match[0].replace(",", ".") : value;
}

function parseQuantityNumber(value: string): number | null {
  const parsed = Number(normalizeQuantityForInput(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeForMatch(value: string): string {
  return normalizeWhitespace(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function hasNoResultsText(): boolean {
  const bodyText = normalizeWhitespace(document.body?.innerText ?? "").toLocaleLowerCase("ru-RU");
  return /(ничего не найдено|не найдено|не найдены|нет товаров|нет результатов|0 товаров|товары не найдены)/iu.test(bodyText);
}

function getPageSignature(config: DomSupplierConfig): string {
  const rows = collectProductElements(config);
  const rowSamples = rows.length <= 20 ? rows : [...rows.slice(0, 10), ...rows.slice(-10)];
  const rowsText = rowSamples
    .map((element) => getText(element).slice(0, 200))
    .join("|");

  return `${location.href}|rows=${rows.length}|${rowsText}|${normalizeWhitespace(document.body?.innerText ?? "").slice(0, 300)}`;
}

function dedupeResults(results: SupplierSearchResult[]): SupplierSearchResult[] {
  const seen = new Set<string>();
  const deduped: SupplierSearchResult[] = [];

  for (const result of results) {
    const key = [
      result.supplierId,
      result.sourceQuery,
      normalizeWhitespace(result.name).toLocaleLowerCase("ru-RU"),
      normalizeWhitespace(result.unitOrPackage).toLocaleLowerCase("ru-RU"),
      result.price,
    ].join("\u0001");

    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(result);
    }
  }

  return deduped;
}

function createDomError(config: DomSupplierConfig, message: string): SupplierDomError {
  return new SupplierDomError(message, {
    adapter: config.name,
    url: location.href,
    title: document.title,
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus(),
    searchInputFound: Boolean(queryFirst(config.selectors.searchInput)),
    productRowsFound: collectProductElements(config).length,
    message
  });
}

function findVisibleSearchInput(config: DomSupplierConfig): HTMLInputElement | HTMLTextAreaElement | null {
  return (
    queryAllUnique<HTMLInputElement | HTMLTextAreaElement>(config.selectors.searchInput).find(
      (element) => isVisible(element) && !isDisabled(element)
    ) ?? null
  );
}

async function activateSearchInput(
  config: DomSupplierConfig,
  input: HTMLInputElement | HTMLTextAreaElement,
  signal?: AbortSignal
): Promise<HTMLInputElement | HTMLTextAreaElement> {
  clickElement(input);

  if (config.id === "smartpro") {
    const fullScreenInput = await waitForSmartProSearchInput(signal);
    if (fullScreenInput) {
      return fullScreenInput;
    }
  }

  await sleep(150, signal);
  return findVisibleSearchInput(config) ?? input;
}

async function waitForSupplierUiReady(config: DomSupplierConfig, signal?: AbortSignal): Promise<void> {
  if (config.id !== "smartpro") {
    return;
  }

  try {
    await waitFor(
      () => {
        const pageText = normalizeWhitespace(document.body?.innerText ?? "").toLocaleLowerCase("ru-RU");
        if (isSmartProLoggedOutPage(location.href.toLocaleLowerCase("ru-RU"), pageText)) {
          return true;
        }
        return !hasSmartProLoadingIndicator() && Boolean(findVisibleSearchInput(config));
      },
      { timeoutMs: 30000, intervalMs: 300, signal }
    );
  } catch {
    // The next explicit search-input check will produce the actionable diagnostic.
  }
}

async function waitForSmartProSearchInput(
  signal?: AbortSignal
): Promise<HTMLInputElement | HTMLTextAreaElement | null> {
  try {
    return await waitFor(
      () =>
        queryAllUnique<HTMLInputElement | HTMLTextAreaElement>([".search-block__input input"]).find(
          (element) => isVisible(element) && !isDisabled(element)
        ) ?? null,
      { timeoutMs: 3000, intervalMs: 100, signal }
    );
  } catch {
    return null;
  }
}

async function waitForSmartProSearchSettled(
  config: DomSupplierConfig,
  query: string,
  signal?: AbortSignal
): Promise<void> {
  await sleep(1200, signal);

  let lastSignature = "";
  let stableSince = 0;
  const minStableMs = 800;

  try {
    await waitFor(
      () => {
        const activeSearchInput = queryFirst<HTMLInputElement | HTMLTextAreaElement>(
          [".search-block__input input", ".category-header .actions__search input"]
        );
        const currentQuery = normalizeWhitespace(activeSearchInput?.value ?? "").toLocaleLowerCase("ru-RU");
        const expectedQuery = normalizeWhitespace(query).toLocaleLowerCase("ru-RU");
        const isExpectedQuery = currentQuery === expectedQuery || currentQuery.includes(expectedQuery);

        const rows = collectProductElements(config).filter(isVisible);
        const hasTerminalState = rows.length > 0 || hasSmartProEmptyState() || hasNoResultsText();
        const isLoading = hasSmartProLoadingIndicator();

        if (!isExpectedQuery || isLoading || !hasTerminalState) {
          lastSignature = "";
          stableSince = 0;
          return false;
        }

        const signature = rows
          .slice(0, 20)
          .map((element) => getText(element).slice(0, 250))
          .join("|");

        if (signature !== lastSignature) {
          lastSignature = signature;
          stableSince = Date.now();
          return false;
        }

        return Date.now() - stableSince >= minStableMs;
      },
      { timeoutMs: 45000, intervalMs: 250, signal }
    );
  } catch {
    throw createDomError(config, `SmartPro не завершил загрузку выдачи по запросу "${query}".`);
  }
}

function hasSmartProLoadingIndicator(): boolean {
  return queryAllUnique<Element>([
    ".search-block--active .loading-state",
    ".search-block--active .preloader",
    ".search-block--active .sp-skeleton",
    ".marketplace-table__intersect-preloader .preloader",
    ".marketplace-table .preloader"
  ]).some(isVisible);
}

function hasSmartProEmptyState(): boolean {
  return queryAllUnique<Element>([
    ".search-block--active .content__empty",
    ".search-block--active .content__empty-wrapper",
    ".sp-empty-state"
  ]).some((element) => isVisible(element) && /не найден/iu.test(getText(element)));
}

function filterNestedElements(elements: Element[]): Element[] {
  const elementSet = new Set(elements);
  return elements.filter((element) => {
    let parent = element.parentElement;
    while (parent) {
      if (elementSet.has(parent)) {
        return false;
      }
      parent = parent.parentElement;
    }
    return true;
  });
}

function isSmartProLoggedOutPage(url: string, pageText: string): boolean {
  return (
    url.includes("smartpro.ru") &&
    !url.includes("/marketplace") &&
    pageText.includes("войти") &&
    pageText.includes("зарегистрироваться")
  );
}

function isMetroLoggedOutPage(
  url: string,
  pageText: string,
  hasPasswordInput: boolean,
  hasGenericAccountMarker: boolean
): boolean {
  if (!url.includes("metro-cc.ru")) {
    return false;
  }

  const hasMetroAccountMarker =
    hasGenericAccountMarker ||
    /(мой metro|мои заказы|личный кабинет|профиль|аккаунт|карта клиента|выйти)/iu.test(pageText);
  if (hasMetroAccountMarker) {
    return false;
  }

  return hasPasswordInput || hasStandaloneWord(pageText, "войти") || url.includes("login") || url.includes("auth");
}

function hasStandaloneWord(text: string, word: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(word)}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
