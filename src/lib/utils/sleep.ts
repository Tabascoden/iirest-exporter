export function createAbortError(message = "Operation aborted"): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, "AbortError");
  }
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    throwIfAborted(signal);
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timeoutId = globalThis.setTimeout(resolve, ms);
    const abort = () => {
      globalThis.clearTimeout(timeoutId);
      reject(createAbortError());
    };

    signal?.addEventListener("abort", abort, { once: true });
  });
}
