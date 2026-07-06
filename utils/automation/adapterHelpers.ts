import type { AppKey } from "../types";
import type { SelectorGroup } from "./types";

const LARGE_PROMPT_CHAR_THRESHOLD = 8_000;
const LARGE_PROMPT_LINE_THRESHOLD = 120;
const CHUNK_LINE_COUNT = 40;
const CHUNK_DELAY_MS = 5;

export interface SetInputTextOptions {
  appKey?: AppKey;
}

export function getInputText(element: HTMLElement): string {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    return element.value;
  }
  return element.innerText ?? element.textContent ?? "";
}

export function countRoleMessages(role: "user" | "assistant"): number {
  return document.querySelectorAll(`div[data-message-author-role='${role}']`).length;
}

function findClickableByText(pattern: RegExp): HTMLElement | null {
  const candidates = document.querySelectorAll("button, a, [role='button']");
  for (const node of candidates) {
    const text = (node.textContent ?? "").trim();
    if (pattern.test(text)) {
      return node as HTMLElement;
    }
  }
  return null;
}

export function hasChatGptLongPromptPreview(): boolean {
  return findClickableByText(/show in text field/i) !== null;
}

export async function expandChatGptLongPromptPreview(): Promise<boolean> {
  const control = findClickableByText(/show in text field/i);
  if (!control) return false;
  clickElement(control);
  await sleep(200);
  return true;
}

async function insertTextInChunks(element: HTMLElement, text: string): Promise<void> {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += CHUNK_LINE_COUNT) {
    const chunk = lines.slice(i, i + CHUNK_LINE_COUNT).join("\n");
    const suffix = i + CHUNK_LINE_COUNT < lines.length ? "\n" : "";
    if (typeof document.execCommand === "function") {
      document.execCommand("insertText", false, chunk + suffix);
    }
    if (CHUNK_DELAY_MS > 0) {
      await sleep(CHUNK_DELAY_MS);
    }
  }
}

function shouldUseChunkedInsert(text: string): boolean {
  const lineCount = text.split("\n").length;
  return text.length >= LARGE_PROMPT_CHAR_THRESHOLD || lineCount >= LARGE_PROMPT_LINE_THRESHOLD;
}

export interface GenerationActivityState {
  lastTextChangeTime: number;
}

export interface GenerationCheckContext {
  stopButtonWasVisible?: boolean;
  stopButtonCurrentlyVisible?: boolean;
  activityState?: GenerationActivityState;
  recentActivityMs?: number;
}
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

/**
 * Clear a contenteditable element's content in a way that also clears the
 * internal model of rich editors (Lexical, ProseMirror, Quill). Selecting all
 * content and deleting via execCommand routes through the editor's own
 * beforeinput handler; a plain `textContent = ""` is added as a DOM-level
 * backstop. Without this, editors that ignore direct DOM mutation retain their
 * previous value and the next insert appends to it, duplicating the text.
 */
function clearContentEditable(element: HTMLElement): void {
  try {
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  } catch {
    // ignore — selection API may be unavailable
  }

  if (typeof document.execCommand === "function") {
    // Delete the selected content through the editor's own handler. This keeps
    // the editor's internal structure (e.g. Lexical's placeholder <p>) intact,
    // so a following insertText has a valid caret position.
    document.execCommand("delete", false);
  } else if ((element.textContent ?? "") !== "") {
    // No execCommand available (rare): fall back to a direct clear. This can
    // desync rich-editor models, but it's the only option in that environment.
    element.textContent = "";
  }
}

/**
 * Insert text by simulating a paste. This is the most reliable programmatic
 * insertion path for Lexical (Perplexity) and other editors that ignore
 * execCommand("insertText") but implement a robust paste handler. The editor
 * reads the text from clipboardData and inserts it exactly once through its
 * normal pipeline (keeping its model in sync).
 */
function insertViaPaste(element: HTMLElement, text: string): void {
  try {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    const pasteEvent = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data
    });
    element.dispatchEvent(pasteEvent);
  } catch {
    // ClipboardEvent / DataTransfer may be unavailable in some contexts.
  }
}

export async function setInputText(
  element: HTMLElement,
  text: string,
  options?: SetInputTextOptions
): Promise<void> {
  // Normalize line endings so \r\n and \r become \n. This ensures consistent
  // handling of multi-line prompts coming from the side panel textarea.
  text = text.replace(/\r\n?/g, '\n');

  if (isContentEditable(element)) {
    const normalize = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "");
    const current = () => normalize(element.textContent ?? "");
    const expected = normalize(text);

    // Try to focus (works in foreground; no-op in background but doesn't throw)
    try {
      element.focus();
    } catch {
      // ignore
    }

    // Clear ANY existing content BEFORE inserting, through the editor's own
    // delete handler so rich-editor models (Lexical/ProseMirror/Quill) are
    // cleared too (a plain `textContent = ""` desyncs them).
    clearContentEditable(element);

    if (shouldUseChunkedInsert(text)) {
      await insertTextInChunks(element, text);
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText"
        })
      );
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    // Fire insertion methods ONE AT A TIME, awaiting after each so that editors
    // which process input asynchronously (Lexical — Perplexity) have time to
    // update the DOM before we decide whether to try the next method. Stop at
    // the first method that lands the *full* text (we check normalized
    // non-whitespace length to support multi-line prompts).
    //
    // This ordering matters: firing several methods synchronously queues
    // multiple async insertions that Lexical all applies a moment later,
    // duplicating the prompt ("Say helloSay hello...").
    const tryMethod = async (fn: () => void): Promise<boolean> => {
      if (current().length >= expected.length) return true;
      fn();
      // Poll briefly for async editors to render the insertion.
      for (let i = 0; i < 6; i++) {
        await sleep(40);
        if (current().length >= expected.length) break;
      }
      return current().length >= expected.length;
    };

    // Method 1: simulated paste — best for preserving newlines and structure
    // across editors (Quill/Gemini, Lexical, etc.). execCommand("insertText")
    // with \n often only inserts the first line (or collapses newlines) in
    // some rich editors like Gemini's ql-editor. We now prefer paste and use
    // a stricter "full content received" check (normalized non-whitespace length)
    // so partial insertions don't short-circuit the better methods.
    let inserted = await tryMethod(() => insertViaPaste(element, text));

    // Method 2: execCommand insertText — fallback, good for many ProseMirror
    // and Quill cases without newlines.
    if (!inserted) {
      inserted = await tryMethod(() => {
        if (typeof document.execCommand === "function") {
          document.execCommand("insertText", false, text);
        }
      });
    }

    // Method 3: synthetic beforeinput.
    if (!inserted) {
      inserted = await tryMethod(() =>
        element.dispatchEvent(
          new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            data: text,
            inputType: "insertText"
          })
        )
      );
    }

    // Method 4 (last resort): set textContent directly.
    if (!inserted) {
      // For multi-line prompts, try to preserve line breaks. Many
      // contenteditables treat \n in textContent as collapsed whitespace.
      if (text.includes('\n')) {
        element.innerHTML = text
          .split('\n')
          .map((line) => (line.length ? line : '<br>'))
          .map((l) => `<div>${l}</div>`)
          .join('');
      } else {
        element.textContent = text;
      }
    }

    // Notify frameworks that the value changed. Editors like Lexical
    // (Perplexity) call preventDefault() on the beforeinput they handle for
    // execCommand("insertText"), which SUPPRESSES the browser's native `input`
    // event — so the host app never learns text was entered and leaves its
    // Submit button disabled / Enter-to-submit gated ("never submits"). We
    // dispatch an `input` event ourselves to trigger that detection.
    //
    // Crucially this event carries NO `data`: Lexical inserts text on
    // `beforeinput`, not `input`, so a data-less `input` is treated as a
    // change notification and will NOT re-insert (which would duplicate).
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText"
      })
    );

    // Give an async editor a moment to react, then guard against duplication:
    // if the editor somehow ended up with more than the intended text, reset to
    // a single clean copy.
    await sleep(50);
    if (current() !== expected && current().length > expected.length) {
      clearContentEditable(element);
      if (text.includes('\n')) {
        element.innerHTML = text
          .split('\n')
          .map((line) => (line.length ? line : '<br>'))
          .map((l) => `<div>${l}</div>`)
          .join('');
      } else {
        element.textContent = text;
      }
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    }

    // A plain change event is safe for all editors (no insertText semantics).
    element.dispatchEvent(new Event("change", { bubbles: true }));
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

/**
 * Wait for the send button to transition from enabled → disabled → enabled.
 * During generation, most LLMs disable the send button. When generation
 * completes, it re-enables. This is a reliable completion signal for apps
 * that don't expose a visible stop button.
 *
 * Returns true if the disabled→enabled transition was observed, false if
 * the button never disabled (generation may have been instant) or timed out.
 */
export async function waitForSendButtonReenabled(
  sendSelectors: string[],
  timeoutMs: number,
  pollIntervalMs = 500
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let wasDisabled = false;

  while (Date.now() < deadline) {
    const button = queryFirstSelector(sendSelectors) as HTMLElement | null;
    if (button) {
      const disabled = isDisabled(button);
      if (disabled) {
        wasDisabled = true;
      } else if (wasDisabled) {
        // Transition: disabled → enabled → generation complete
        return true;
      }
    }
    await sleep(pollIntervalMs);
  }

  return false;
}

export function isDisabled(element: HTMLElement): boolean {
  if (
    element.hasAttribute("disabled") ||
    element.getAttribute("aria-disabled") === "true" ||
    (element as HTMLButtonElement).disabled === true
  ) {
    return true;
  }

  // Class-based disabled state (e.g. DeepSeek's `ds-button--disabled`), matched
  // per-token. Do NOT use a loose /disabled/ test: Tailwind ships `disabled:`
  // *variant* classes (e.g. `disabled:opacity-50`, `disabled:pointer-events-none`)
  // that are present in the className at all times and only take effect when the
  // real `disabled` attribute is set — Claude's enabled Send button carries
  // several of them, and a loose test would wrongly treat it as disabled.
  const className = typeof element.className === "string" ? element.className : "";
  const isDisabledClass = className
    .split(/\s+/)
    .some((token) => token === "disabled" || token.endsWith("-disabled"));
  if (isDisabledClass) {
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

  // Native click — dispatches a single trusted click event
  element.click();
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

export function getLatestResponseContainer(responseSelectors: string[]): Element | null {
  if (responseSelectors.length === 0) return null;
  const containers = document.querySelectorAll(responseSelectors.join(", "));
  return containers.length > 0 ? containers[containers.length - 1] : null;
}

export function getMonitorSelectors(selectors: SelectorGroup): string[] {
  return selectors.responseMonitor ?? selectors.response;
}

export function isGenerationActive(
  selectors: SelectorGroup,
  context: GenerationCheckContext = {}
): boolean {
  const {
    stopButtonWasVisible = false,
    activityState,
    recentActivityMs = 3_000
  } = context;
  const stopButtonCurrentlyVisible =
    context.stopButtonCurrentlyVisible ??
    (selectors.completion.length > 0 && queryFirstSelector(selectors.completion) !== null);

  if (stopButtonCurrentlyVisible) {
    return true;
  }

  // Thinking/searching UI only blocks completion before the stop button has
  // appeared. After generation ends the thinking accordion often stays in the
  // DOM (Claude) — it must not keep the wait loop alive forever.
  if (
    !stopButtonWasVisible &&
    selectors.generating?.length &&
    queryFirstSelector(selectors.generating)
  ) {
    return true;
  }

  const monitor = getLatestResponseContainer(getMonitorSelectors(selectors));
  const sendButton = queryFirstSelector(selectors.send) as HTMLElement | null;
  if (sendButton && isDisabled(sendButton) && hasResponseStarted(monitor)) {
    return true;
  }

  if (activityState && Date.now() - activityState.lastTextChangeTime < recentActivityMs) {
    return true;
  }

  return false;
}

/** Stricter check used after a tentative completion — only resume if generation restarted. */
export function isGenerationResumed(
  selectors: SelectorGroup,
  activityState?: GenerationActivityState,
  recentActivityMs = 1_000
): boolean {
  if (selectors.completion.length > 0 && queryFirstSelector(selectors.completion)) {
    return true;
  }

  if (activityState && Date.now() - activityState.lastTextChangeTime < recentActivityMs) {
    return true;
  }

  return false;
}

export function extractTextFromElement(element: Element, excludeSelectors?: string[]): string {
  const clone = element.cloneNode(true) as Element;
  clone
    .querySelectorAll(
      "button, [aria-label='Copy'], [aria-label='Stop generating'], [role='menu'], script, style, svg, .copy-button"
    )
    .forEach((el) => el.remove());

  if (excludeSelectors) {
    for (const selector of excludeSelectors) {
      try {
        clone.querySelectorAll(selector).forEach((el) => el.remove());
      } catch {
        // invalid selector — skip
      }
    }
  }

  const blockSelector = "p, h1, h2, h3, h4, h5, h6, li, tr, div, br, hr";
  clone.querySelectorAll(blockSelector).forEach((el) => {
    el.appendChild(document.createTextNode("\n"));
  });

  return (clone.textContent ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
