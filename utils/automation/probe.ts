import {
  checkBlockedState,
  clickElement,
  extractTextFromElement,
  getResponseContainer,
  hasResponseStarted,
  isDisabled,
  queryFirstSelector,
  setInputText,
  sleep,
  waitForInput,
  waitForSendButtonEnabled
} from "./adapterHelpers";
import type { ProbeField, ProbeMode, ProbeResult, ProbeStep, ProbeStepStatus, SelectorGroup } from "./types";
import { DEFAULT_AUTOMATION_TIMEOUTS } from "./types";
import type { AppKey } from "../types";

function isTextInput(element: HTMLElement): boolean {
  return element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement;
}

const PROBE_TEST_PROMPT = "Say hello";
const PROBE_SEND_BUTTON_TIMEOUT_MS = 5_000;
const PROBE_RESPONSE_WAIT_MS = 30_000;
const PROBE_COMPLETION_POLL_MS = 500;
const PROBE_DOM_STABILIZATION_MS = 6_000;
const PROBE_MIN_RESPONSE_LENGTH = 5;

function step(field: ProbeField, status: ProbeStepStatus, detail: string, matchedSelector?: string): ProbeStep {
  return { field, status, detail, matchedSelector };
}

function checkSelectorField(
  field: ProbeField,
  selectors: string[] | undefined,
  isExpected: boolean
): ProbeStep {
  if (!selectors || selectors.length === 0) {
    return step(field, "skip", "No selectors configured");
  }

  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        const tag = element.tagName.toLowerCase();
        const cls = typeof element.className === "string" && element.className ? `.${element.className.split(" ").join(".")}` : "";
        const id = element.id ? `#${element.id}` : "";
        return step(field, "pass", `matched ${tag}${id}${cls}`, selector);
      }
    } catch {
      // invalid selector — skip to next
    }
  }

  if (isExpected) {
    return step(field, "fail", `none of ${selectors.length} selectors matched`);
  }
  return step(field, "skip", "no match (may appear after interaction)");
}

export async function runProbeStatic(appKey: AppKey, selectors: SelectorGroup): Promise<ProbeResult> {
  const startTime = Date.now();
  const steps: ProbeStep[] = [];

  // Wait for the input element to appear (SPAs render content after page load).
  // Poll for up to 8 seconds before running static checks.
  const inputDeadline = Date.now() + 8_000;
  let inputReady = false;
  while (Date.now() < inputDeadline) {
    if (queryFirstSelector(selectors.input)) {
      inputReady = true;
      break;
    }
    await sleep(500);
  }

  if (!inputReady) {
    steps.push(step("input", "fail", "input element not found after 8s (page may be loading or login required)"));
    steps.push(checkSelectorField("send", selectors.send, true));
    steps.push(checkSelectorField("response", selectors.response, false));
    steps.push(checkSelectorField("completion", selectors.completion, false));
    steps.push(checkSelectorField("blocked", selectors.blocked, false));
    steps.push(checkSelectorField("loginError", selectors.loginError, false));
    return { appKey, mode: "static", steps, durationMs: Date.now() - startTime };
  }

  steps.push(checkSelectorField("input", selectors.input, true));
  steps.push(checkSelectorField("send", selectors.send, true));
  steps.push(checkSelectorField("response", selectors.response, false));
  steps.push(checkSelectorField("completion", selectors.completion, false));
  steps.push(checkSelectorField("blocked", selectors.blocked, false));
  steps.push(checkSelectorField("loginError", selectors.loginError, false));

  const sendElement = queryFirstSelector(selectors.send);
  if (sendElement && isDisabled(sendElement as HTMLElement)) {
    steps.push(step("send", "warn", "send button is disabled (normal on empty input)"));
  }

  return { appKey, mode: "static", steps, durationMs: Date.now() - startTime };
}

export async function runProbeLive(appKey: AppKey, selectors: SelectorGroup): Promise<ProbeResult> {
  const startTime = Date.now();
  const steps: ProbeStep[] = [];

  const staticResult = await runProbeStatic(appKey, selectors);
  steps.push(...staticResult.steps);

  const inputElement = await waitForInput(selectors.input, DEFAULT_AUTOMATION_TIMEOUTS.loginGraceMs);
  if (!inputElement) {
    steps.push(step("injection", "fail", "input element not found"));
    return { appKey, mode: "live", steps, durationMs: Date.now() - startTime };
  }

  if (checkBlockedState(selectors.blocked)) {
    steps.push(step("injection", "fail", "blocked state detected"));
    return { appKey, mode: "live", steps, durationMs: Date.now() - startTime };
  }

  try {
    await setInputText(inputElement, PROBE_TEST_PROMPT);
  } catch (error) {
    steps.push(step("injection", "fail", `injection threw: ${error instanceof Error ? error.message : "unknown"}`));
    return { appKey, mode: "live", steps, durationMs: Date.now() - startTime };
  }

  // Retry reading the injected text — ProseMirror and similar editors
  // process events asynchronously, so the text may not be readable immediately.
  let injectedText = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(300);
    injectedText =
      inputElement instanceof HTMLTextAreaElement
        ? inputElement.value
        : inputElement instanceof HTMLInputElement
          ? inputElement.value
          : (inputElement.innerText ?? inputElement.textContent ?? "");
    if (injectedText.trim()) break;
  }

  if (!injectedText.trim()) {
    steps.push(step("injection", "fail", "text not injected (empty after 5 retries)"));
    return { appKey, mode: "live", steps, durationMs: Date.now() - startTime };
  }
  const injectedChars = injectedText.trim().length;
  const expectedChars = PROBE_TEST_PROMPT.length;
  if (injectedChars > expectedChars) {
    steps.push(
      step(
        "injection",
        "fail",
        `duplicated: injected ${injectedChars} chars but expected ${expectedChars} ("${injectedText.trim().slice(0, 60)}")`
      )
    );
  } else {
    steps.push(step("injection", "pass", `text injected (${injectedChars} chars)`));
  }

  const sendButton = await waitForSendButtonEnabled(selectors.send, PROBE_SEND_BUTTON_TIMEOUT_MS);

  if (sendButton && !isDisabled(sendButton)) {
    clickElement(sendButton);
    steps.push(step("send_click", "pass", "send button clicked"));

    // Poll for stop button / response start as confirmation of submission.
    const submitted = await pollForSubmissionStart(selectors, inputElement);
    if (!submitted) {
      if (isTextInput(inputElement)) {
        submitViaEnterKey(inputElement);
        steps.push(step("send_click", "warn", "send button click didn't submit — Enter-key backup sent"));
      } else {
        steps.push(step("send_click", "warn", "send button click didn't submit — Enter backup skipped (contenteditable)"));
      }
    }
  } else {
    if (isTextInput(inputElement)) {
      steps.push(step("send_click", "warn", "send button not found — trying Enter-key fallback"));
      submitViaEnterKey(inputElement);
      await sleep(500);
    } else {
      steps.push(step("send_click", "warn", "send button not found — Enter fallback skipped (contenteditable)"));
    }
  }

  const responseResult = await waitForProbeResponseCompletion(selectors);
  if (responseResult.timedOut) {
    steps.push(step("response_wait", "fail", "response timed out (30s)"));
  } else {
    steps.push(step("response_wait", "pass", `response completed (${responseResult.durationMs}ms)`));
  }

  const previewText = await extractProbeResponse(selectors);
  if (previewText && previewText.trim().length > 0) {
    const preview = previewText.trim().slice(0, 100);
    steps.push(step("response_preview", "pass", `extracted: "${preview}${previewText.length > 100 ? "..." : ""}"`));
  } else {
    steps.push(step("response_preview", "fail", "no response text extracted"));
  }

  return { appKey, mode: "live", steps, durationMs: Date.now() - startTime };
}

function checkProbeSubmissionSignals(selectors: SelectorGroup, inputElement: HTMLElement): boolean {
  if (selectors.completion.length > 0) {
    const stopButton = queryFirstSelector(selectors.completion);
    if (stopButton) return true;
  }
  const responseContainer = getResponseContainer(selectors.response);
  if (hasResponseStarted(responseContainer)) return true;
  const sendButton = queryFirstSelector(selectors.send) as HTMLElement | null;
  if (!sendButton || isDisabled(sendButton)) return true;
  const remainingText =
    inputElement instanceof HTMLTextAreaElement || inputElement instanceof HTMLInputElement
      ? inputElement.value
      : (inputElement.innerText ?? inputElement.textContent ?? "");
  if (!remainingText.trim()) return true;
  return false;
}

async function pollForSubmissionStart(
  selectors: SelectorGroup,
  inputElement: HTMLElement,
  pollMs: number = 5_000,
  intervalMs: number = 200
): Promise<boolean> {
  if (checkProbeSubmissionSignals(selectors, inputElement)) return true;

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (result: boolean): void => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearInterval(intervalId);
      clearTimeout(deadlineTimer);
      resolve(result);
    };

    const check = (): void => {
      if (checkProbeSubmissionSignals(selectors, inputElement)) {
        finish(true);
      }
    };

    const observer = new MutationObserver(() => check());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    const intervalId = setInterval(check, intervalMs);
    const deadlineTimer = setTimeout(() => finish(false), pollMs);
  });
}

function submitViaEnterKey(inputElement: HTMLElement): void {
  try {
    inputElement.focus();
  } catch {
    // ignore
  }

  const enterInit = {
    bubbles: true,
    cancelable: true,
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13
  };

  inputElement.dispatchEvent(new KeyboardEvent("keydown", enterInit));
  inputElement.dispatchEvent(new KeyboardEvent("keypress", enterInit));
  inputElement.dispatchEvent(new KeyboardEvent("keyup", enterInit));
}

interface ProbeResponseResult {
  timedOut: boolean;
  durationMs: number;
}

/**
 * Wait for the probe response to complete.
 *
 * Uses MutationObserver as primary signal (fires in background tabs)
 * with setInterval backup for text-stabilization detection when no
 * mutations fire during the quiet period.
 */
async function waitForProbeResponseCompletion(selectors: SelectorGroup): Promise<ProbeResponseResult> {
  const startTime = Date.now();

  return new Promise<ProbeResponseResult>((resolve) => {
    let stopButtonWasVisible = false;
    let lastText = "";
    let lastTextChangeTime = Date.now();
    let textEverObserved = false;
    let settled = false;

    function cleanup() {
      observer.disconnect();
      clearTimeout(timeoutHandle);
      clearInterval(pollHandle);
    }

    function finish(timedOut: boolean) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ timedOut, durationMs: Date.now() - startTime });
    }

    function checkCompletion(): boolean {
      // Signal 1: Stop button (authoritative)
      const stopButton = queryFirstSelector(selectors.completion);
      if (stopButton) {
        stopButtonWasVisible = true;
      } else if (stopButtonWasVisible) {
        return true;
      }

      // Signal 2: Text stabilization (only when stop button not visible)
      if (!stopButton) {
        const currentContainer = getResponseContainer(selectors.response);
        if (currentContainer && hasResponseStarted(currentContainer)) {
          const text = (currentContainer.textContent ?? "").trim();
          if (text.length >= PROBE_MIN_RESPONSE_LENGTH) {
            if (text !== lastText) {
              lastText = text;
              lastTextChangeTime = Date.now();
              textEverObserved = true;
            } else if (textEverObserved) {
              const quietTime = Date.now() - lastTextChangeTime;
              if (quietTime >= PROBE_DOM_STABILIZATION_MS) {
                return true;
              }
            }
          }
        }
      }
      return false;
    }

    // Primary signal: MutationObserver (fires even in background tabs)
    const observer = new MutationObserver(() => {
      if (settled) return;
      if (checkCompletion()) finish(false);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Hard timeout
    const timeoutHandle = setTimeout(() => finish(true), PROBE_RESPONSE_WAIT_MS);

    // Backup polling loop (throttled in background tabs, but sufficient
    // for the 6s text-stabilization quiet period)
    const pollHandle = setInterval(() => {
      if (settled) return;
      if (checkCompletion()) finish(false);
    }, PROBE_COMPLETION_POLL_MS);
  });
}

async function extractProbeResponse(selectors: SelectorGroup): Promise<string> {
  if (selectors.response.length === 0) return "";

  const containers = document.querySelectorAll(selectors.response.join(", "));
  if (containers.length === 0) return "";

  const target = containers[containers.length - 1];
  return extractTextFromElement(target as HTMLElement);
}
