import { sleep, throwIfAborted } from "./sleep";

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

export function safeQuerySelector<T extends Element>(
  root: ParentNode,
  selector: string
): T | null {
  try {
    return root.querySelector<T>(selector);
  } catch {
    return null;
  }
}

export function queryFirst<T extends Element>(
  selectors: string[],
  root: ParentNode = document
): T | null {
  for (const selector of selectors) {
    const element = safeQuerySelector<T>(root, selector);
    if (element) {
      return element;
    }
  }
  return null;
}

export function queryAllUnique<T extends Element>(
  selectors: string[],
  root: ParentNode = document
): T[] {
  const seen = new Set<T>();
  const result: T[] = [];

  for (const selector of selectors) {
    let elements: NodeListOf<T>;
    try {
      elements = root.querySelectorAll<T>(selector);
    } catch {
      continue;
    }

    for (const element of elements) {
      if (!seen.has(element)) {
        seen.add(element);
        result.push(element);
      }
    }
  }

  return result;
}

export function getText(element: Element | null | undefined): string {
  return normalizeWhitespace(element?.textContent ?? "");
}

export function isVisible(element: Element): boolean {
  const htmlElement = element as HTMLElement;
  const style = window.getComputedStyle(htmlElement);
  const rect = htmlElement.getBoundingClientRect();
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0" &&
    rect.width > 0 &&
    rect.height > 0
  );
}

export function setInputValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  input.focus();

  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    input.value = value;
  }

  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function pressEnter(element: HTMLElement): void {
  for (const type of ["keydown", "keypress", "keyup"] as const) {
    element.dispatchEvent(
      new KeyboardEvent(type, {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        code: "Enter"
      })
    );
  }
}

export function clickElement(element: Element): void {
  (element as HTMLElement).click();
}

export async function waitFor<T>(
  predicate: () => T | Promise<T>,
  options: { timeoutMs: number; intervalMs?: number; signal?: AbortSignal }
): Promise<T> {
  const startedAt = Date.now();
  const intervalMs = options.intervalMs ?? 200;

  while (Date.now() - startedAt < options.timeoutMs) {
    throwIfAborted(options.signal);
    const value = await predicate();
    if (value) {
      return value;
    }
    await sleep(intervalMs, options.signal);
  }

  throw new Error("Timed out while waiting for page state");
}

export function findClickableByText(textCandidates: string[], root: ParentNode = document): HTMLElement | null {
  const normalizedCandidates = textCandidates.map((text) => text.toLocaleLowerCase("ru-RU"));
  const elements = queryAllUnique<HTMLElement>(
    ["button", "a", "[role='button']", "input[type='submit']", "input[type='button']"],
    root
  );

  for (const element of elements) {
    if (!isVisible(element) || isDisabled(element)) {
      continue;
    }

    const text =
      element instanceof HTMLInputElement
        ? normalizeWhitespace(element.value)
        : getText(element);
    const lowerText = text.toLocaleLowerCase("ru-RU");

    if (normalizedCandidates.some((candidate) => lowerText === candidate || lowerText.includes(candidate))) {
      return element;
    }
  }

  return null;
}

export function isDisabled(element: Element): boolean {
  const html = element as HTMLElement;
  return (
    html.hasAttribute("disabled") ||
    html.getAttribute("aria-disabled") === "true" ||
    /\b(disabled|is-disabled|inactive)\b/iu.test(html.className)
  );
}

export function getClosestUrl(element: Element): string {
  const ownLink = element.matches("a[href]") ? (element as HTMLAnchorElement) : null;
  const link = ownLink ?? element.querySelector<HTMLAnchorElement>("a[href]");
  if (!link?.href || link.href.startsWith("javascript:")) {
    return "";
  }
  return link.href;
}
