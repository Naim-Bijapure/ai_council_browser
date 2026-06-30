import type { SelectorGroup } from "./types";
import { DEFAULT_AUTOMATION_TIMEOUTS } from "./types";

export function queryFirstSelector(selectors: string[]): Element | null {
  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector);
      if (element) return element;
    } catch {
      // Invalid selector — skip to next in priority order.
    }
  }
  return null;
}

export function isContentEditable(element: HTMLElement): boolean {
  return element.tagName.toLowerCase() === "div" || element.isContentEditable;
}

export function setInputText(element: HTMLElement, text: string): void {
  if (isContentEditable(element)) {
    // Try to focus (works in foreground; no-op in background but doesn't throw)
    try {
      element.focus();
    } catch {
      // ignore
    }

    // Clear existing content
    element.textContent = "";

    // Method 1: execCommand insertText (best for ProseMirror, needs focus)
    if (typeof document.execCommand === "function") {
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      document.execCommand("insertText", false, text);
    }

    // If execCommand didn't work (e.g. background tab), use beforeinput + direct set
    if ((element.textContent ?? "").trim() !== text.trim()) {
      element.textContent = "";

      // Dispatch beforeinput — ProseMirror and similar editors listen for this
      element.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          data: text,
          inputType: "insertText"
        })
      );

      // Set text content directly
      if ((element.textContent ?? "").trim() !== text.trim()) {
        element.textContent = text;
      }

      // Dispatch input event so frameworks pick up the change
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: text,
          inputType: "insertText"
        })
      );
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }
  } else if (element instanceof HTMLTextAreaElement) {
    // Focus first — React/Antd may ignore input events on unfocused elements
    try {
      element.focus();
    } catch {
      // ignore
    }

    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) {
      setter.call(element, text);
    } else {
      element.value = text;
    }

    // Reset React's value tracker so onChange fires (React suppresses input
    // events when the tracked value matches the DOM value after a programmatic
    // set). This is the same technique used by Cypress and Playwright.
    delete (element as any)._valueTracker;

    // Use InputEvent (not generic Event) so React/framework onChange handlers fire
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: text,
        inputType: "insertText"
      })
    );
    element.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (element instanceof HTMLInputElement) {
    try {
      element.focus();
    } catch {
      // ignore
    }

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) {
      setter.call(element, text);
    } else {
      element.value = text;
    }

    delete (element as any)._valueTracker;

    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: text,
        inputType: "insertText"
      })
    );
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

export async function waitForInput(
  selectors: string[],
  timeoutMs = DEFAULT_AUTOMATION_TIMEOUTS.loginGraceMs,
  pollIntervalMs = 500
): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const element = queryFirstSelector(selectors) as HTMLElement | null;
    // In background tabs, offsetParent can be null even for visible elements,
    // so accept any element that exists and has non-zero size or is in the DOM
    if (element && (element.offsetParent !== null || element.isConnected)) {
      return element;
    }
    await sleep(pollIntervalMs);
  }

  // Last try — return even if not visible (might be in a loading state)
  return queryFirstSelector(selectors) as HTMLElement | null;
}

export async function waitForSendButtonEnabled(
  sendSelectors: string[],
  timeoutMs = DEFAULT_AUTOMATION_TIMEOUTS.sendButtonEnableMs,
  pollIntervalMs = DEFAULT_AUTOMATION_TIMEOUTS.sendButtonPollIntervalMs
): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const button = queryFirstSelector(sendSelectors) as HTMLElement | null;
    if (button && !isDisabled(button)) {
      return button;
    }
    await sleep(pollIntervalMs);
  }

  return null;
}

export function isDisabled(element: HTMLElement): boolean {
  if (
    element.hasAttribute("disabled") ||
    element.getAttribute("aria-disabled") === "true" ||
    (element as HTMLButtonElement).disabled === true
  ) {
    return true;
  }

  const className = typeof element.className === "string" ? element.className : "";
  if (/disabled/i.test(className)) {
    return true;
  }

  return false;
}

export function clickElement(element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const pointerOpts = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: "mouse"
  };

  const mouseOpts = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0
  };

  try {
    element.dispatchEvent(new PointerEvent("pointerdown", pointerOpts));
  } catch {
    // PointerEvent may not be available in all contexts
  }
  element.dispatchEvent(new MouseEvent("mousedown", mouseOpts));

  try {
    element.dispatchEvent(new PointerEvent("pointerup", pointerOpts));
  } catch {
    // ignore
  }
  element.dispatchEvent(new MouseEvent("mouseup", mouseOpts));

  // Native click + synthetic MouseEvent
  element.click();
  element.dispatchEvent(new MouseEvent("click", mouseOpts));
}

export async function waitForElement(
  selectors: string[],
  timeoutMs: number,
  pollIntervalMs = 500
): Promise<Element | null> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const element = queryFirstSelector(selectors);
    if (element) return element;
    await sleep(pollIntervalMs);
  }

  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getResponseContainer(responseSelectors: string[]): Element | null {
  return queryFirstSelector(responseSelectors);
}

export function extractTextFromElement(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  clone
    .querySelectorAll(
      "button, [data-testid], .copy-button, [aria-label='Copy'], [role='menu'], script, style, svg"
    )
    .forEach((el) => el.remove());
  return (clone.textContent ?? "").replace(/\s+\n/g, "\n").trim();
}

export function scrollResponseToBottom(container: Element): void {
  const scrollable = findScrollableParent(container);
  if (scrollable) {
    scrollable.scrollTop = scrollable.scrollHeight;
  } else {
    container.scrollTop = container.scrollHeight;
  }
  window.scrollTo(0, document.body.scrollHeight);
}

function findScrollableParent(element: Element): Element | null {
  let current: Element | null = element;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    if (
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

export function checkBlockedState(blockedSelectors: string[] | undefined): boolean {
  if (!blockedSelectors || blockedSelectors.length === 0) return false;
  return queryFirstSelector(blockedSelectors) !== null;
}

export function hasResponseStarted(responseContainer: Element | null): boolean {
  if (!responseContainer) return false;
  const text = responseContainer.textContent ?? "";
  return text.trim().length > 0;
}
