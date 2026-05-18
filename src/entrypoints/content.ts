import { defineContentScript } from "wxt/utils/define-content-script";
import type { ContentRequest, ContentResponse } from "../lib/messages";
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
    "https://*.metro-cc.ru/*"
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
  return typeof candidate?.type === "string" && candidate.type.startsWith("SUPPLIER_");
}

async function handleContentRequest(request: ContentRequest): Promise<ContentResponse> {
  switch (request.type) {
    case "SUPPLIER_PING":
      return {
        ok: true,
        data: {
          url: location.href,
          title: document.title
        }
      };

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
          delayMs: request.options.delayMs
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

function getAdapter(supplierId: SupplierId) {
  const adapter = getSupplierAdapter(supplierId);
  if (!adapter) {
    throw new Error(`Unknown supplier adapter: ${supplierId}`);
  }
  return adapter;
}

function serializeError(error: unknown): ContentResponse {
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
