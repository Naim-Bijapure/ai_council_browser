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

const PROBE_TEST_PROMPT = "Say hello";
const PROBE_SEND_BUTTON_TIMEOUT_MS = 5_000;
const PROBE_RESPONSE_WAIT_MS = 30_000;
const PROBE_COMPLETION_POLL_MS = 500;
const PROBE_DOM_STABILIZATION_MS = 2_000;
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
    setInputText(inputElement, PROBE_TEST_PROMPT);
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
  steps.push(step("injection", "pass", `text injected (${injectedText.trim().length} chars)`));

  const sendButton = await waitForSendButtonEnabled(selectors.send, PROBE_SEND_BUTTON_TIMEOUT_MS);

  if (sendButton && !isDisabled(sendButton)) {
    clickElement(sendButton);
    steps.push(step("send_click", "pass", "send button clicked"));
    await sleep(500);

    // Check if the click actually submitted — if the input still has text,
    // the framework ignored the synthetic click. Try Enter key as a backup.
    const remainingText =
      inputElement instanceof HTMLTextAreaElement || inputElement instanceof HTMLInputElement
        ? inputElement.value
        : (inputElement.innerText ?? inputElement.textContent ?? "");
    if (remainingText.trim()) {
      submitViaEnterKey(inputElement);
      steps.push(step("send_click", "warn", "send button click didn't submit — Enter-key backup sent"));
    }
  } else {
    steps.push(step("send_click", "warn", "send button not found — trying Enter-key fallback"));
    submitViaEnterKey(inputElement);
    await sleep(500);
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

async function waitForProbeResponseCompletion(selectors: SelectorGroup): Promise<ProbeResponseResult> {
  const startTime = Date.now();
  const deadline = startTime + PROBE_RESPONSE_WAIT_MS;
  let stopButtonWasVisible = false;
  let mutationObserved = false;
  let lastMutationTime = Date.now();

  const observer = new MutationObserver(() => {
    mutationObserved = true;
    lastMutationTime = Date.now();
  });

  let observedTarget: Element | null = null;

  try {
    while (Date.now() < deadline) {
      const stopButton = queryFirstSelector(selectors.completion);
      if (stopButton) {
        stopButtonWasVisible = true;
      } else if (stopButtonWasVisible) {
        await sleep(PROBE_COMPLETION_POLL_MS);
        if (!queryFirstSelector(selectors.completion)) {
          return { timedOut: false, durationMs: Date.now() - startTime };
        }
      }

      const currentContainer = getResponseContainer(selectors.response);

      if (currentContainer) {
        if (observedTarget !== currentContainer) {
          observer.disconnect();
          observedTarget = currentContainer;
          observer.observe(currentContainer, {
            childList: true,
            subtree: true,
            characterData: true
          });
        }

        if (hasResponseStarted(currentContainer)) {
          const text = (currentContainer.textContent ?? "").trim();
          if (text.length >= PROBE_MIN_RESPONSE_LENGTH && mutationObserved) {
            const quietTime = Date.now() - lastMutationTime;
            if (quietTime >= PROBE_DOM_STABILIZATION_MS) {
              return { timedOut: false, durationMs: Date.now() - startTime };
            }
          }
        }
      }

      await sleep(PROBE_COMPLETION_POLL_MS);
    }

    return { timedOut: true, durationMs: Date.now() - startTime };
  } finally {
    observer.disconnect();
  }
}

async function extractProbeResponse(selectors: SelectorGroup): Promise<string> {
  if (selectors.response.length === 0) return "";

  const containers = document.querySelectorAll(selectors.response.join(", "));
  if (containers.length === 0) return "";

  const target = containers[containers.length - 1];
  return extractTextFromElement(target as HTMLElement);
}
