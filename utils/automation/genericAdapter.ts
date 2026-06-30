import {
  checkBlockedState,
  clickElement,
  extractTextFromElement,
  getResponseContainer,
  hasResponseStarted,
  isDisabled,
  queryFirstSelector,
  scrollResponseToBottom,
  setInputText,
  sleep,
  waitForInput,
  waitForSendButtonEnabled
} from "./adapterHelpers";
import type { AdapterResult, SendConfirmationResult, SelectorGroup } from "./types";
import { DEFAULT_AUTOMATION_TIMEOUTS } from "./types";
import type { AppKey } from "../types";

const STOP_BUTTON_POLL_INTERVAL_MS = 500;
const DOM_STABILIZATION_QUIET_MS = 2_000;
const MIN_RESPONSE_LENGTH = 10;
const SEND_CONFIRMATION_TIMEOUT_MS = 15_000;
const SEND_CONFIRMATION_POLL_MS = 300;

function submitViaEnterKey(inputElement: HTMLElement): void {
  // Focus the element to ensure key events are received
  try {
    inputElement.focus();
  } catch {
    // ignore
  }

  // Dispatch keydown → keypress → keyup sequence for Enter
  // Many frameworks (Antd onPressEnter, React onKeyDown) listen on keydown
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

function log(appKey: AppKey, stage: string, detail?: unknown): void {
  console.log(`[${appKey} Adapter] ${stage}`, detail ?? "");
}

export async function runAgent(
  appKey: AppKey,
  prompt: string,
  selectors: SelectorGroup
): Promise<AdapterResult> {
  log(appKey, "Starting agent run", { promptLength: prompt.length });

  // Step 1: Wait for input
  log(appKey, "Waiting for input element (10s grace)...");
  const inputElement = await waitForInput(selectors.input, DEFAULT_AUTOMATION_TIMEOUTS.loginGraceMs);
  if (!inputElement) {
    log(appKey, "FAILED: input element not found after 10s");
    return { success: false, errorReason: "dom_error", completedAt: Date.now() };
  }
  log(appKey, "Input element found", { tag: inputElement.tagName, id: inputElement.id });

  // Step 2: Check blocked
  if (checkBlockedState(selectors.blocked)) {
    log(appKey, "FAILED: blocked state detected");
    return { success: false, errorReason: "rate_limited", completedAt: Date.now() };
  }

  // Step 3: Inject text
  log(appKey, "Injecting prompt text...");
  try {
    setInputText(inputElement, prompt);
  } catch (error) {
    log(appKey, "FAILED: injection threw error", error instanceof Error ? error.message : error);
    return { success: false, errorReason: "dom_error", completedAt: Date.now() };
  }

  await sleep(100);
  const injectedText =
    inputElement instanceof HTMLTextAreaElement
      ? inputElement.value
      : (inputElement.textContent ?? "");
  if (!injectedText.trim()) {
    log(appKey, "FAILED: text not injected (empty after set)");
    return { success: false, errorReason: "dom_error", completedAt: Date.now() };
  }
  log(appKey, "Text injected", { contentLength: injectedText.length });

  // Step 4: Wait for send button
  log(appKey, "Waiting for send button to enable...");
  const sendButton = await waitForSendButtonEnabled(
    selectors.send,
    DEFAULT_AUTOMATION_TIMEOUTS.sendButtonEnableMs
  );

  if (sendButton && !isDisabled(sendButton)) {
    // Step 5: Click send
    log(appKey, "Clicking send button...");
    clickElement(sendButton);
    log(appKey, "Send button clicked");
    await sleep(500);

    // Check if the click actually submitted — if the input still has text,
    // the framework ignored the synthetic click. Try Enter key as a backup.
    const remainingText =
      inputElement instanceof HTMLTextAreaElement || inputElement instanceof HTMLInputElement
        ? inputElement.value
        : (inputElement.innerText ?? inputElement.textContent ?? "");
    if (remainingText.trim()) {
      log(appKey, "Send button click didn't submit — trying Enter-key backup...");
      submitViaEnterKey(inputElement);
    }
  } else {
    // Fallback: submit via Enter key (works for Antd onPressEnter, React onKeyDown, etc.)
    log(appKey, "Send button not found or disabled — trying Enter-key fallback...");
    submitViaEnterKey(inputElement);
    log(appKey, "Enter key dispatched");
    await sleep(500);
  }

  // Step 6: Wait for response
  log(appKey, "Waiting for response completion...");
  const responseResult = await waitForResponseCompletion(appKey, selectors, DEFAULT_AUTOMATION_TIMEOUTS.responseWaitMs);
  log(appKey, "Response wait finished", { timedOut: responseResult.timedOut });

  // Step 7: Extract response
  if (responseResult.timedOut) {
    log(appKey, "Timed out — extracting partial response...");
    const partialText = await extractLatestResponse(selectors);
    if (!partialText || partialText.trim().length === 0) {
      return { success: false, errorReason: "timeout", completedAt: Date.now() };
    }
    return { success: true, responseText: partialText, completedAt: Date.now() };
  }

  log(appKey, "Extracting response text...");
  const responseText = await extractLatestResponse(selectors);
  log(appKey, "Response extracted", { length: responseText.length });

  if (!responseText || responseText.trim().length === 0) {
    log(appKey, "FAILED: empty response extracted");
    return { success: false, errorReason: "dom_error", completedAt: Date.now() };
  }

  log(appKey, "Agent run complete");
  return { success: true, responseText, completedAt: Date.now() };
}

export async function runJudge(
  appKey: AppKey,
  prompt: string,
  selectors: SelectorGroup
): Promise<SendConfirmationResult> {
  log(appKey, "Starting judge run", { promptLength: prompt.length });

  // Step 1: Wait for input
  log(appKey, "Waiting for input element (10s grace)...");
  const inputElement = await waitForInput(selectors.input, DEFAULT_AUTOMATION_TIMEOUTS.loginGraceMs);
  if (!inputElement) {
    log(appKey, "FAILED: input element not found after 10s");
    return { sent: false, errorReason: "dom_error" };
  }

  // Step 2: Check blocked
  if (checkBlockedState(selectors.blocked)) {
    log(appKey, "FAILED: blocked state detected");
    return { sent: false, errorReason: "rate_limited" };
  }

  // Step 3: Inject text
  log(appKey, "Injecting judge prompt...");
  try {
    setInputText(inputElement, prompt);
  } catch (error) {
    log(appKey, "FAILED: injection threw error", error instanceof Error ? error.message : error);
    return { sent: false, errorReason: "dom_error" };
  }

  await sleep(100);
  log(appKey, "Text injected");

  // Step 4: Wait for send button
  log(appKey, "Waiting for send button to enable...");
  const sendButton = await waitForSendButtonEnabled(
    selectors.send,
    DEFAULT_AUTOMATION_TIMEOUTS.sendButtonEnableMs
  );

  const urlBeforeSend = window.location.href;
  const hadResponseContainer = getResponseContainer(selectors.response) !== null;

  if (sendButton && !isDisabled(sendButton)) {
    log(appKey, "Clicking send button...");
    clickElement(sendButton);
    await sleep(500);

    // Check if the click actually submitted — if the input still has text,
    // the framework ignored the synthetic click. Try Enter key as a backup.
    const remainingText =
      inputElement instanceof HTMLTextAreaElement || inputElement instanceof HTMLInputElement
        ? inputElement.value
        : (inputElement.innerText ?? inputElement.textContent ?? "");
    if (remainingText.trim()) {
      log(appKey, "Send button click didn't submit — trying Enter-key backup...");
      submitViaEnterKey(inputElement);
    }
  } else {
    log(appKey, "Send button not found or disabled — trying Enter-key fallback...");
    submitViaEnterKey(inputElement);
    log(appKey, "Enter key dispatched");
    await sleep(500);
  }

  // Step 6: Confirm message sent
  log(appKey, "Confirming message sent...");
  const confirmed = await confirmMessageSent(appKey, selectors, urlBeforeSend, hadResponseContainer);
  log(appKey, "Send confirmation result", confirmed);
  return confirmed;
}

interface ResponseWaitResult {
  timedOut: boolean;
}

async function waitForResponseCompletion(
  appKey: AppKey,
  selectors: SelectorGroup,
  timeoutMs: number
): Promise<ResponseWaitResult> {
  const deadline = Date.now() + timeoutMs;
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
      // Signal 1: stop button was visible then disappeared
      const stopButton = queryFirstSelector(selectors.completion);
      if (stopButton) {
        stopButtonWasVisible = true;
      } else if (stopButtonWasVisible) {
        await sleep(STOP_BUTTON_POLL_INTERVAL_MS);
        const stopButtonRecheck = queryFirstSelector(selectors.completion);
        if (!stopButtonRecheck) {
          log(appKey, "  Completion detected: stop button disappeared");
          return { timedOut: false };
        }
      }

      // Signal 3: DOM stabilization (scoped to response container)
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
          if (text.length >= MIN_RESPONSE_LENGTH && mutationObserved) {
            const quietTime = Date.now() - lastMutationTime;
            if (quietTime >= DOM_STABILIZATION_QUIET_MS) {
              log(appKey, "  Completion detected: DOM stabilized", { textLength: text.length });
              return { timedOut: false };
            }
          }
        }
      }

      await sleep(STOP_BUTTON_POLL_INTERVAL_MS);
    }

    log(appKey, "  Response wait timed out");
    return { timedOut: true };
  } finally {
    observer.disconnect();
  }
}

async function extractLatestResponse(selectors: SelectorGroup): Promise<string> {
  const containers = document.querySelectorAll(selectors.response.join(", "));
  if (containers.length === 0) return "";

  const lastContainer = containers[containers.length - 1];
  scrollResponseToBottom(lastContainer);

  await sleep(500);

  const refreshed = document.querySelectorAll(selectors.response.join(", "));
  const target = refreshed[refreshed.length - 1] ?? lastContainer;
  return extractTextFromElement(target);
}

async function confirmMessageSent(
  appKey: AppKey,
  selectors: SelectorGroup,
  urlBeforeSend: string,
  hadResponseContainer: boolean
): Promise<SendConfirmationResult> {
  const deadline = Date.now() + SEND_CONFIRMATION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (window.location.href !== urlBeforeSend) {
      log(appKey, "  Confirmed: URL changed");
      return { sent: true };
    }

    if (!hadResponseContainer) {
      const responseContainer = getResponseContainer(selectors.response);
      if (responseContainer && (responseContainer.textContent ?? "").trim().length > 0) {
        log(appKey, "  Confirmed: response container appeared with content");
        return { sent: true };
      }
    } else {
      const containers = document.querySelectorAll(selectors.response.join(", "));
      if (containers.length > 0) {
        const lastContainer = containers[containers.length - 1];
        if ((lastContainer.textContent ?? "").trim().length > 0) {
          log(appKey, "  Confirmed: new response content detected");
          return { sent: true };
        }
      }
    }

    await sleep(SEND_CONFIRMATION_POLL_MS);
  }

  log(appKey, "  FAILED: send confirmation timed out");
  return { sent: false, errorReason: "send_failed" };
}
