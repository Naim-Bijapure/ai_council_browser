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

/**
 * Returns true for `<textarea>` and `<input>` elements — the only input types
 * where dispatching an Enter KeyboardEvent is a safe submit fallback.
 * For contenteditable divs (Claude, Gemini, ChatGPT, Perplexity, Kimi) Enter
 * inserts a newline rather than submitting, so the Enter backup must be skipped.
 */
function isTextInput(element: HTMLElement): boolean {
  return element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement;
}

const STOP_BUTTON_POLL_INTERVAL_MS = 500;
// How long to wait for the input element to render. Agents now open in a fresh
// popup window per run (cold start), so heavy SPAs (Gemini, Qwen, Claude) need
// more time to render their input than the old pre-warmed tabs did.
const INPUT_READY_WAIT_MS = 30_000;
const DOM_STABILIZATION_QUIET_MS = 6_000;
const MIN_RESPONSE_LENGTH = 10;
const SEND_CONFIRMATION_TIMEOUT_MS = 15_000;
const SEND_CONFIRMATION_POLL_MS = 300;
// Grace period before falling back to text stabilization when no stop button has been seen.
// Prevents "Searching the web" / "Thinking..." transient text from triggering premature completion
// on apps whose stop button appears slightly after generation begins (e.g. Gemini web-search mode).
const STOP_BUTTON_GRACE_MS = 6_000;

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

/**
 * Check the 4 submission signals once and return true if any is detected.
 */
function checkSubmissionSignals(selectors: SelectorGroup, inputElement: HTMLElement): boolean {
  // 1. Stop/completion button visible
  if (selectors.completion.length > 0) {
    const stopButton = queryFirstSelector(selectors.completion);
    if (stopButton) return true;
  }
  // 2. Response container has started populating
  const responseContainer = getResponseContainer(selectors.response);
  if (hasResponseStarted(responseContainer)) return true;
  // 3. Send button became disabled or disappeared
  const sendButton = queryFirstSelector(selectors.send) as HTMLElement | null;
  if (!sendButton || isDisabled(sendButton)) return true;
  // 4. Input was cleared
  const remainingText =
    inputElement instanceof HTMLTextAreaElement || inputElement instanceof HTMLInputElement
      ? inputElement.value
      : (inputElement.innerText ?? inputElement.textContent ?? "");
  if (!remainingText.trim()) return true;
  return false;
}

/**
 * Detect whether a submission succeeded by watching for DOM mutations.
 *
 * Uses MutationObserver on document.body (childList + subtree + characterData)
 * as the PRIMARY signal — MutationObserver callbacks fire even in throttled
 * background tabs, unlike setTimeout which Chrome clamps to ~1s. A setInterval
 * backup (also fires in background, though throttled) and a setTimeout hard
 * deadline ensure the function always resolves.
 *
 * Signals checked on every mutation / interval tick:
 *   1. Stop/completion button appeared
 *   2. Response container has non-empty text
 *   3. Send button became disabled or disappeared
 *   4. Input was cleared
 *
 * Returns true as soon as any signal is detected, or false if the deadline
 * expires without any signal.
 */
async function didSubmissionStart(
  selectors: SelectorGroup,
  inputElement: HTMLElement,
  pollMs: number = 5_000,
  intervalMs: number = 200
): Promise<boolean> {
  // Fast path — check immediately before setting up observers
  if (checkSubmissionSignals(selectors, inputElement)) return true;

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
      if (checkSubmissionSignals(selectors, inputElement)) {
        finish(true);
      }
    };

    // Primary: MutationObserver — fires even in throttled background tabs
    const observer = new MutationObserver(() => check());
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Backup: setInterval — throttled to ~1s in background but still fires
    const intervalId = setInterval(check, intervalMs);

    // Hard deadline
    const deadlineTimer = setTimeout(() => finish(false), pollMs);
  });
}

// Guards against a second run being started while one is already in flight for
// this content-script context. Duplicate AGENT_RUN/JUDGE_RUN messages (e.g. a
// re-injected content script registering a second listener, or a resend) would
// otherwise call setInputText concurrently and stack injections, duplicating
// the prompt in the input box.
let runInFlight = false;

export async function runAgent(
  appKey: AppKey,
  prompt: string,
  selectors: SelectorGroup,
  onSubmitted?: () => void
): Promise<AdapterResult> {
  if (runInFlight) {
    log(appKey, "Ignoring duplicate agent run — one already in flight");
    return { success: false, errorReason: "cancelled", completedAt: Date.now() };
  }
  runInFlight = true;
  try {
    return await runAgentInner(appKey, prompt, selectors, onSubmitted);
  } finally {
    runInFlight = false;
  }
}

async function runAgentInner(
  appKey: AppKey,
  prompt: string,
  selectors: SelectorGroup,
  onSubmitted?: () => void
): Promise<AdapterResult> {
  log(appKey, "Starting agent run", { promptLength: prompt.length });

  // Step 1: Wait for input
  log(appKey, "Waiting for input element...");
  const inputElement = await waitForInput(selectors.input, INPUT_READY_WAIT_MS);
  if (!inputElement) {
    log(appKey, "FAILED: input element not found");
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
    await setInputText(inputElement, prompt);
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

    // Check if the click actually submitted — poll for stop button / response start.
    const submitted = await didSubmissionStart(selectors, inputElement);
    if (!submitted) {
      if (isTextInput(inputElement)) {
        log(appKey, "Send button click didn't submit — trying Enter-key backup...");
        submitViaEnterKey(inputElement);
      } else {
        log(appKey, "Send button click didn't submit — skipping Enter backup (contenteditable, would insert newline)");
      }
    }
  } else {
    // Fallback: submit via Enter key (works for Antd onPressEnter, React onKeyDown, etc.)
    if (isTextInput(inputElement)) {
      log(appKey, "Send button not found or disabled — trying Enter-key fallback...");
      submitViaEnterKey(inputElement);
      log(appKey, "Enter key dispatched");
      await sleep(500);
    } else {
      log(appKey, "Send button not found or disabled — skipping Enter fallback (contenteditable)");
    }
  }

  // Notify background that submission has been attempted — the background
  // can now switch the user's tab back (silent mode) while the response
  // completes in the background via MutationObserver.
  try {
    onSubmitted?.();
  } catch {
    // ignore callback errors
  }

  // Step 6: Wait for response
  log(appKey, "Waiting for response completion...");
  const responseResult = await waitForResponseCompletion(appKey, selectors, DEFAULT_AUTOMATION_TIMEOUTS.responseWaitMs);
  log(appKey, "Response wait finished", { timedOut: responseResult.timedOut });

  // Step 7: Extract response
  if (responseResult.timedOut) {
    log(appKey, "Timed out — extracting partial response...");
    const partialText = await extractLatestResponse(appKey, selectors);
    if (!partialText || partialText.trim().length === 0) {
      return { success: false, errorReason: "timeout", completedAt: Date.now() };
    }
    return { success: true, responseText: partialText, completedAt: Date.now() };
  }

  log(appKey, "Extracting response text...");
  const responseText = await extractLatestResponse(appKey, selectors);
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
  if (runInFlight) {
    log(appKey, "Ignoring duplicate judge run — one already in flight");
    return { sent: false, errorReason: "cancelled" };
  }
  runInFlight = true;
  try {
    return await runJudgeInner(appKey, prompt, selectors);
  } finally {
    runInFlight = false;
  }
}

async function runJudgeInner(
  appKey: AppKey,
  prompt: string,
  selectors: SelectorGroup
): Promise<SendConfirmationResult> {
  log(appKey, "Starting judge run", { promptLength: prompt.length });

  // Step 1: Wait for input
  log(appKey, "Waiting for input element...");
  const inputElement = await waitForInput(selectors.input, INPUT_READY_WAIT_MS);
  if (!inputElement) {
    log(appKey, "FAILED: input element not found");
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
    await setInputText(inputElement, prompt);
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
    log(appKey, "Send button clicked");

    const submitted = await didSubmissionStart(selectors, inputElement);
    if (!submitted) {
      if (isTextInput(inputElement)) {
        log(appKey, "Send button click didn't submit — trying Enter-key backup...");
        submitViaEnterKey(inputElement);
      } else {
        log(appKey, "Send button click didn't submit — skipping Enter backup (contenteditable)");
      }
    }
  } else {
    if (isTextInput(inputElement)) {
      log(appKey, "Send button not found or disabled — trying Enter-key fallback...");
      submitViaEnterKey(inputElement);
      log(appKey, "Enter key dispatched");
      await sleep(500);
    } else {
      log(appKey, "Send button not found or disabled — skipping Enter fallback (contenteditable)");
    }
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

/**
 * Wait for the LLM response to complete.
 *
 * Uses a MutationObserver as the PRIMARY completion signal because
 * MutationObserver callbacks fire even in background (throttled) tabs,
 * unlike setTimeout/setInterval which Chrome throttles to ~1s minimum.
 *
 * A backup setInterval polling loop provides a safety net for apps
 * without a stop button (Gemini, Claude, Qwen, Kimi, Perplexity) where
 * text stabilization is the only signal — if no DOM mutations occur
 * during the quiet period, the polling loop detects it instead.
 */
async function waitForResponseCompletion(
  appKey: AppKey,
  selectors: SelectorGroup,
  timeoutMs: number
): Promise<ResponseWaitResult> {
  return new Promise<ResponseWaitResult>((resolve) => {
    let stopButtonWasVisible = false;
    let lastText = "";
    const monitorStartTime = Date.now();
    let lastTextChangeTime = monitorStartTime;
    let textEverObserved = false;
    let settled = false;

    function cleanup() {
      observer.disconnect();
      clearTimeout(timeoutHandle);
      clearInterval(pollHandle);
    }

    function finish(timedOut: boolean, reason: string) {
      if (settled) return;
      settled = true;
      cleanup();
      if (timedOut) {
        log(appKey, "  Response wait timed out", { stopButtonWasVisible });
      } else {
        log(appKey, `  Completion detected: ${reason}`, { textLength: lastText.length });
      }
      resolve({ timedOut });
    }

    function checkCompletion(): string | null {
      // Signal 1: Stop button (authoritative when available)
      // Checked every iteration — the stop button may appear late (e.g. after
      // ChatGPT finishes a web search before generating the response).
      const stopButton = queryFirstSelector(selectors.completion);
      if (stopButton) {
        stopButtonWasVisible = true;
      } else if (stopButtonWasVisible) {
        return "stop button disappeared";
      }

      // Signal 2: Text content stabilization (fallback)
      // Only when stop button is NOT currently visible AND the grace period has elapsed.
      // The grace period prevents transient loading text ("Searching the web", "Thinking…")
      // from triggering completion before the stop button has had time to appear.
      const elapsedMs = Date.now() - monitorStartTime;
      const graceElapsed = stopButtonWasVisible || elapsedMs >= STOP_BUTTON_GRACE_MS;
      if (!stopButton && graceElapsed) {
        const container = getResponseContainer(selectors.response);
        if (container && hasResponseStarted(container)) {
          const text = (container.textContent ?? "").trim();
          if (text.length >= MIN_RESPONSE_LENGTH) {
            if (text !== lastText) {
              lastText = text;
              lastTextChangeTime = Date.now();
              textEverObserved = true;
            } else if (textEverObserved) {
              const quietTime = Date.now() - lastTextChangeTime;
              if (quietTime >= DOM_STABILIZATION_QUIET_MS) {
                return `text stabilized (${quietTime}ms quiet)`;
              }
            }
          }
        }
      }
      return null;
    }

    // Primary signal: MutationObserver (fires even in background tabs)
    const observer = new MutationObserver(() => {
      if (settled) return;
      const reason = checkCompletion();
      if (reason) finish(false, reason);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Hard timeout safety net (may be delayed in background tabs — that's OK)
    const timeoutHandle = setTimeout(() => finish(true, "timeout"), timeoutMs);

    // Backup polling loop (throttled to ~1s in background tabs by Chrome,
    // but that's sufficient for the 6s text-stabilization quiet period).
    // Essential for apps without a stop button where no mutations fire
    // during the streaming quiet period.
    const pollHandle = setInterval(() => {
      if (settled) return;
      const reason = checkCompletion();
      if (reason) finish(false, reason);
    }, STOP_BUTTON_POLL_INTERVAL_MS);
  });
}

async function extractLatestResponse(appKey: AppKey, selectors: SelectorGroup): Promise<string> {
  const containers = document.querySelectorAll(selectors.response.join(", "));
  log(appKey, `extract: Found ${containers.length} response container(s)`, {
    selectors: selectors.response.join(", ")
  });

  if (containers.length === 0) return "";

  const lastContainer = containers[containers.length - 1];
  scrollResponseToBottom(lastContainer);

  await sleep(500);

  const refreshed = document.querySelectorAll(selectors.response.join(", "));
  const target = refreshed[refreshed.length - 1] ?? lastContainer;
  const extracted = extractTextFromElement(target);
  log(appKey, `extract: Extracted ${extracted.length} chars`, {
    htmlLength: target.innerHTML.length,
    textPreview: extracted.slice(0, 200)
  });
  return extracted;
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
