import { defineContentScript } from "wxt/utils/define-content-script";
import type { ContentRequest, ContentResponse, PageDiagnostic } from "../lib/messages";
import { IirestImportError, importPricesToIirest, normalizeIirestBaseUrl } from "../lib/iirest/import";
import { getSupplierAdapter } from "../lib/suppliers/registry";
import { SupplierDomError } from "../lib/suppliers/dom-search";
import type { SupplierId } from "../lib/suppliers/types";

const activeControllers = new Map<string, AbortController>();

export default defineContentScript({
  matches: [
    "https://gfc-russia.ru/*",
    "https://*.gfc-russia.ru/*",
    "https://smartpro.ru/*",
    "https://*.smartpro.ru/*",
    "https://metro-cc.ru/*",
    "https://*.metro-cc.ru/*",
    "https://iirest.ru/*",
    "https://*.iirest.ru/*",
    "http://localhost/*",
    "http://127.0.0.1/*"
  ],
  runAt: "document_idle",
  main() {
    chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (!isContentRequest(message)) {
        return undefined;
      }

      void handleContentRequest(message)
        .then((response) => sendResponse(response))
        .catch((error: unknown) => sendResponse(serializeError(error)));

      return true;
    });
  }
});

function isContentRequest(message: unknown): message is ContentRequest {
  const candidate = message as { type?: unknown } | null;
  return (
    typeof candidate?.type === "string" &&
    (candidate.type.startsWith("SUPPLIER_") || candidate.type.startsWith("IIREST_"))
  );
}

async function handleContentRequest(request: ContentRequest): Promise<ContentResponse> {
  switch (request.type) {
    case "SUPPLIER_PING":
    case "IIREST_PING":
      return {
        ok: true,
        data: getPageDiagnostic()
      };

    case "IIREST_IMPORT_PRICES": {
      const baseUrl = normalizeIirestBaseUrl(request.payload.baseUrl);
      const expectedOrigin = new URL(baseUrl).origin;
      if (location.origin !== expectedOrigin) {
        throw new Error(`Вкладка iiRest открыта на ${location.origin}, а в настройках указан ${expectedOrigin}.`);
      }

      const response = await importPricesToIirest(location.origin, request.payload.mode, request.payload.results);
      return { ok: true, data: response };
    }

    case "SUPPLIER_DETECT_LOGIN": {
      const adapter = getAdapter(request.supplierId);
      const state = await adapter.detectLoginState();
      return { ok: true, data: state };
    }

    case "SUPPLIER_SEARCH": {
      const adapter = getAdapter(request.supplierId);
      const controller = new AbortController();
      activeControllers.set(request.runId, controller);

      try {
        const results = await adapter.search(request.query, {
          signal: controller.signal,
          maxPages: request.options.maxPages,
          delayMs: request.options.delayMs
        });
        return { ok: true, data: results };
      } finally {
        activeControllers.delete(request.runId);
      }
    }

    case "SUPPLIER_ADD_TO_CART": {
      const adapter = getAdapter(request.supplierId);
      const controller = new AbortController();
      activeControllers.set(request.runId, controller);

      try {
        const result = await adapter.addToCart(request.item, {
          signal: controller.signal,
          delayMs: request.options.delayMs,
          maxPages: request.options.maxPages
        });
        return { ok: true, data: result };
      } finally {
        activeControllers.delete(request.runId);
      }
    }

    case "SUPPLIER_ABORT": {
      if (request.runId) {
        activeControllers.get(request.runId)?.abort();
      } else {
        for (const controller of activeControllers.values()) {
          controller.abort();
        }
        activeControllers.clear();
      }
      return { ok: true, data: true };
    }
  }
}

function getPageDiagnostic(): PageDiagnostic {
  return {
    url: location.href,
    title: document.title,
    visibilityState: document.visibilityState,
    hasFocus: document.hasFocus()
  };
}

function getAdapter(supplierId: SupplierId) {
  const adapter = getSupplierAdapter(supplierId);
  if (!adapter) {
    throw new Error(`Unknown supplier adapter: ${supplierId}`);
  }
  return adapter;
}

function serializeError(error: unknown): ContentResponse {
  if (error instanceof IirestImportError) {
    return {
      ok: false,
      error: error.message,
      status: error.status
    };
  }

  if (error instanceof SupplierDomError) {
    return {
      ok: false,
      error: error.message,
      diagnostic: error.diagnostic
    };
  }

  if (error instanceof Error) {
    return {
      ok: false,
      error: error.name === "AbortError" ? "Остановлено пользователем" : error.message
    };
  }

  return {
    ok: false,
    error: "Неизвестная ошибка content script"
  };
}
