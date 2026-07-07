import {
  checkBlockedState,
  clickElement,
  countRoleMessages,
  expandChatGptLongPromptPreview,
  extractTextFromElement,
  getInputText,
  getLatestResponseContainer,
  getMonitorSelectors,
  getResponseContainer,
  hasChatGptLongPromptPreview,
  hasResponseStarted,
  isDisabled,
  isGenerationActive,
  isGenerationResumed,
  queryFirstSelector,
  scrollResponseToBottom,
  setInputText,
  sleep,
  waitForInput,
  waitForSendButtonEnabled,
  type GenerationActivityState
} from "./adapterHelpers";
import { getSupportedApp } from "../appRegistry";
import { isCapturableChatUrl } from "../chatUrl";
import type { AdapterResult, AutomationTimeouts, SendConfirmationResult, SelectorGroup } from "./types";
import { DEFAULT_AUTOMATION_TIMEOUTS } from "./types";
import type { AppKey } from "../types";

const JUDGE_URL_CAPTURE_MS = 15_000;

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
const DOM_STABILIZATION_QUIET_MS_LONG = 10_000;
const MIN_RESPONSE_LENGTH = 10;
const POST_COMPLETION_VERIFY_MS = 2_000;
const RECENT_TEXT_ACTIVITY_MS = 3_000;
const SEND_CONFIRMATION_TIMEOUT_MS = 30_000;
const SEND_CONFIRMATION_POLL_MS = 300;
// Grace period before falling back to text stabilization when no stop button has been seen.
// Prevents "Searching the web" / "Thinking..." transient text from triggering premature completion
// on apps whose stop button appears slightly after generation begins (e.g. Gemini web-search mode).
const STOP_BUTTON_GRACE_MS = 6_000;
// Debounce before treating a stop-button disappearance as final completion.
// Reasoning models (Qwen, and similar "thinking" models) briefly hide the stop
// button in the gap between the thinking phase ending and the answer phase
// starting. Without this debounce, that flicker is mistaken for completion and
// the response is extracted mid-"Thinking..." (e.g. an 11-char stub instead of
// the real answer). Requiring the button to stay gone for this long before
// declaring completion survives that gap while still reacting quickly once the
// button is genuinely gone for good. Symmetric with STOP_BUTTON_GRACE_MS (same
// class of problem on the other end of generation) — biased toward avoiding a
// truncated response over shaving a few seconds off every agent's run.
const STOP_BUTTON_DISAPPEAR_DEBOUNCE_MS = 6_000;

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

interface SubmissionSnapshot {
  inputTextBeforeSend: string;
  userMessageCountBeforeSend: number;
  sendButtonWasEnabled: boolean;
  urlBeforeSend: string;
}

function captureSubmissionSnapshot(
  selectors: SelectorGroup,
  inputElement: HTMLElement
): SubmissionSnapshot {
  const sendButton = queryFirstSelector(selectors.send) as HTMLElement | null;
  return {
    inputTextBeforeSend: getInputText(inputElement),
    userMessageCountBeforeSend: countRoleMessages("user"),
    sendButtonWasEnabled: !!(sendButton && !isDisabled(sendButton)),
    urlBeforeSend: window.location.href
  };
}

function normalizePromptLength(text: string): number {
  return text.replace(/\s+/g, "").length;
}

async function ensurePromptInjected(
  appKey: AppKey,
  inputElement: HTMLElement,
  prompt: string,
  selectors?: SelectorGroup
): Promise<boolean> {
  let injectedLength = normalizePromptLength(getInputText(inputElement));
  const expectedLength = normalizePromptLength(prompt);
  if (expectedLength > 0 && injectedLength >= expectedLength * 0.85) {
    return true;
  }

  if (selectors && expectedLength > 0 && injectedLength < expectedLength * 0.5) {
    const freshInput = queryFirstSelector(selectors.input) as HTMLElement | null;
    if (freshInput && freshInput !== inputElement) {
      injectedLength = normalizePromptLength(getInputText(freshInput));
    }
  }

  if (appKey === "chatgpt" && hasChatGptLongPromptPreview()) {
    await expandChatGptLongPromptPreview();
    await sleep(300);
    const verifySource = selectors ? (queryFirstSelector(selectors.input) as HTMLElement | null) ?? inputElement : inputElement;
    injectedLength = normalizePromptLength(getInputText(verifySource));
    if (expectedLength > 0 && injectedLength >= expectedLength * 0.85) {
      return true;
    }
  }

  if (expectedLength > 0 && injectedLength < expectedLength * 0.5) {
    const reInjectTarget = selectors ? (queryFirstSelector(selectors.input) as HTMLElement | null) ?? inputElement : inputElement;
    await setInputText(reInjectTarget, prompt, { appKey });
    await sleep(200);
    injectedLength = normalizePromptLength(getInputText(reInjectTarget));
  }

  return expectedLength === 0 || injectedLength >= expectedLength * 0.5;
}

/**
 * Check whether a submission actually started. Requires positive evidence —
 * a missing/disabled send button alone is NOT treated as success (ChatGPT's
 * long-prompt attachment preview breaks that heuristic).
 */
function checkSubmissionSignals(
  selectors: SelectorGroup,
  inputElement: HTMLElement,
  snapshot: SubmissionSnapshot
): boolean {
  if (selectors.completion.length > 0 && queryFirstSelector(selectors.completion)) {
    return true;
  }

  if (countRoleMessages("user") > snapshot.userMessageCountBeforeSend) {
    return true;
  }

  const remainingText = getInputText(inputElement);
  if (snapshot.inputTextBeforeSend.trim() && !remainingText.trim()) {
    return true;
  }

  if (snapshot.sendButtonWasEnabled) {
    const sendButton = queryFirstSelector(selectors.send) as HTMLElement | null;
    if (!sendButton || isDisabled(sendButton)) {
      return true;
    }
  }

  const responseContainer = getLatestResponseContainer(selectors.response);
  if (
    responseContainer &&
    countRoleMessages("assistant") > 0 &&
    hasResponseStarted(responseContainer)
  ) {
    return true;
  }

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
  snapshot: SubmissionSnapshot,
  pollMs: number = 5_000,
  intervalMs: number = 200
): Promise<boolean> {
  // Fast path — check immediately before setting up observers
  if (checkSubmissionSignals(selectors, inputElement, snapshot)) return true;

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
      if (checkSubmissionSignals(selectors, inputElement, snapshot)) {
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
    await setInputText(inputElement, prompt, { appKey });
  } catch (error) {
    log(appKey, "FAILED: injection threw error", error instanceof Error ? error.message : error);
    return { success: false, errorReason: "dom_error", completedAt: Date.now() };
  }

  await sleep(100);
  if (!(await ensurePromptInjected(appKey, inputElement, prompt, selectors))) {
    log(appKey, "FAILED: text not injected (empty or truncated after set)");
    return { success: false, errorReason: "dom_error", completedAt: Date.now() };
  }
  log(appKey, "Text injected", { contentLength: getInputText(inputElement).length });

  // Step 4: Wait for send button
  log(appKey, "Waiting for send button to enable...");
  const sendButton = await waitForSendButtonEnabled(
    selectors.send,
    DEFAULT_AUTOMATION_TIMEOUTS.sendButtonEnableMs
  );
  const submissionSnapshot = captureSubmissionSnapshot(selectors, inputElement);

  if (sendButton && !isDisabled(sendButton)) {
    // Step 5: Click send
    log(appKey, "Clicking send button...");
    clickElement(sendButton);
    log(appKey, "Send button clicked");

    // Check if the click actually submitted — poll for stop button / response start.
    const submitted = await didSubmissionStart(selectors, inputElement, submissionSnapshot);
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
  const responseResult = await waitForResponseCompletion(appKey, selectors, DEFAULT_AUTOMATION_TIMEOUTS);
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
    await setInputText(inputElement, prompt, { appKey });
  } catch (error) {
    log(appKey, "FAILED: injection threw error", error instanceof Error ? error.message : error);
    return { sent: false, errorReason: "dom_error" };
  }

  await sleep(100);
  if (!(await ensurePromptInjected(appKey, inputElement, prompt, selectors))) {
    log(appKey, "FAILED: judge prompt not injected (empty or truncated after set)");
    return { sent: false, errorReason: "dom_error" };
  }
  log(appKey, "Text injected", { length: getInputText(inputElement).length });

  // Step 4: Wait for send button
  log(appKey, "Waiting for send button to enable...");
  const sendButton = await waitForSendButtonEnabled(
    selectors.send,
    DEFAULT_AUTOMATION_TIMEOUTS.sendButtonEnableMs
  );
  const submissionSnapshot = captureSubmissionSnapshot(selectors, inputElement);

  if (sendButton && !isDisabled(sendButton)) {
    log(appKey, "Clicking send button...");
    clickElement(sendButton);
    log(appKey, "Send button clicked");

    const submitted = await didSubmissionStart(selectors, inputElement, submissionSnapshot);
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

  // Step 6: Confirm message sent, then wait briefly for SPA URL updates.
  log(appKey, "Confirming message sent...");
  const confirmed = await confirmMessageSent(appKey, selectors, submissionSnapshot, inputElement);
  if (!confirmed.sent) {
    log(appKey, "Send confirmation result", confirmed);
    return confirmed;
  }

  const landingUrl = getSupportedApp(appKey).newChatUrl;
  let chatUrl = window.location.href;
  const captureDeadline = Date.now() + JUDGE_URL_CAPTURE_MS;

  while (Date.now() < captureDeadline) {
    const href = window.location.href;
    if (isCapturableChatUrl(href, landingUrl, submissionSnapshot.urlBeforeSend)) {
      chatUrl = href;
      break;
    }
    await sleep(300);
  }

  const result = { sent: true as const, chatUrl };
  log(appKey, "Send confirmation result", result);
  return result;
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
  timeouts: Pick<AutomationTimeouts, "responseIdleMs" | "maxResponseWaitMs">
): Promise<ResponseWaitResult> {
  return new Promise<ResponseWaitResult>((resolve) => {
    let stopButtonWasVisible = false;
    let stopButtonGoneSince: number | null = null;
    let lastText = "";
    const monitorStartTime = Date.now();
    let lastTextChangeTime = monitorStartTime;
    let lastActivityTime = monitorStartTime;
    let textEverObserved = false;
    let settled = false;
    let verifyTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingCompletionReason: string | null = null;
    const activityState: GenerationActivityState = { lastTextChangeTime };

    function generationContext(stopButtonCurrentlyVisible: boolean): Parameters<typeof isGenerationActive>[1] {
      return {
        stopButtonWasVisible,
        stopButtonCurrentlyVisible,
        activityState,
        recentActivityMs: RECENT_TEXT_ACTIVITY_MS
      };
    }

    function cleanup() {
      observer.disconnect();
      clearInterval(pollHandle);
      if (verifyTimer) clearTimeout(verifyTimer);
    }

    function finish(timedOut: boolean, reason: string) {
      if (settled) return;
      settled = true;
      pendingCompletionReason = null;
      cleanup();
      if (timedOut) {
        log(appKey, `  Response wait timed out: ${reason}`, { stopButtonWasVisible });
      } else {
        log(appKey, `  Completion detected: ${reason}`, { textLength: lastText.length });
      }
      resolve({ timedOut });
    }

    function scheduleCompletion(reason: string) {
      if (settled || verifyTimer || pendingCompletionReason) return;
      pendingCompletionReason = reason;
      verifyTimer = setTimeout(() => {
        verifyTimer = null;
        const reasonToFinish = pendingCompletionReason;
        pendingCompletionReason = null;
        if (settled) return;
        if (isGenerationResumed(selectors, activityState)) {
          log(appKey, "  Post-verify: generation resumed, continuing wait");
          return;
        }
        finish(false, reasonToFinish ?? reason);
      }, POST_COMPLETION_VERIFY_MS);
    }

    function touchActivity() {
      const now = Date.now();
      lastActivityTime = now;
      activityState.lastTextChangeTime = now;
    }

    function checkTimeouts(stopButtonCurrentlyVisible: boolean): string | null {
      if (Date.now() - monitorStartTime >= timeouts.maxResponseWaitMs) {
        return "absolute timeout";
      }
      if (
        !isGenerationActive(selectors, generationContext(stopButtonCurrentlyVisible)) &&
        Date.now() - lastActivityTime >= timeouts.responseIdleMs
      ) {
        return "idle timeout";
      }
      return null;
    }

    function checkCompletion(): string | null {
      const stopButton = queryFirstSelector(selectors.completion);
      const stopButtonCurrentlyVisible = stopButton !== null;

      if (isGenerationActive(selectors, generationContext(stopButtonCurrentlyVisible))) {
        touchActivity();
      }

      const timeoutReason = checkTimeouts(stopButtonCurrentlyVisible);
      if (timeoutReason) return `__timeout__:${timeoutReason}`;

      if (stopButton) {
        stopButtonWasVisible = true;
        stopButtonGoneSince = null;
        touchActivity();
      } else if (stopButtonWasVisible) {
        if (stopButtonGoneSince === null) {
          stopButtonGoneSince = Date.now();
        }
        const goneMs = Date.now() - stopButtonGoneSince;
        if (goneMs >= STOP_BUTTON_DISAPPEAR_DEBOUNCE_MS) {
          return "stop button disappeared";
        }
      }

      const elapsedMs = Date.now() - monitorStartTime;
      const graceElapsed = stopButtonWasVisible || elapsedMs >= STOP_BUTTON_GRACE_MS;
      const stabilizationMs = stopButtonWasVisible
        ? DOM_STABILIZATION_QUIET_MS
        : DOM_STABILIZATION_QUIET_MS_LONG;

      if (
        !stopButton &&
        graceElapsed &&
        !isGenerationActive(selectors, generationContext(false))
      ) {
        const container = getLatestResponseContainer(getMonitorSelectors(selectors));
        if (container && hasResponseStarted(container)) {
          const text = (container.textContent ?? "").trim();
          if (text.length >= MIN_RESPONSE_LENGTH) {
            if (text !== lastText) {
              lastText = text;
              lastTextChangeTime = Date.now();
              textEverObserved = true;
              touchActivity();
            } else if (textEverObserved) {
              const quietTime = Date.now() - lastTextChangeTime;
              if (quietTime >= stabilizationMs) {
                return `text stabilized (${quietTime}ms quiet)`;
              }
            }
          }
        }
      }
      return null;
    }

    function handleTick() {
      if (settled) return;
      if (pendingCompletionReason && verifyTimer) return;
      const reason = checkCompletion();
      if (!reason) return;
      if (reason.startsWith("__timeout__:")) {
        finish(true, reason.slice("__timeout__:".length));
        return;
      }
      scheduleCompletion(reason);
    }

    const observer = new MutationObserver(() => {
      handleTick();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    const pollHandle = setInterval(handleTick, STOP_BUTTON_POLL_INTERVAL_MS);
  });
}

async function extractLatestResponse(appKey: AppKey, selectors: SelectorGroup): Promise<string> {
  const monitorSelectors = getMonitorSelectors(selectors);
  let target = getLatestResponseContainer(monitorSelectors);

  if (!target) {
    target = getLatestResponseContainer(selectors.response);
  }

  log(appKey, "extract: Using latest response container", {
    selectors: monitorSelectors.join(", ")
  });

  if (!target) return "";

  scrollResponseToBottom(target);

  await sleep(500);

  const refreshed =
    getLatestResponseContainer(monitorSelectors) ??
    getLatestResponseContainer(selectors.response) ??
    target;
  const extracted = extractTextFromElement(refreshed, selectors.responseExclude);
  log(appKey, `extract: Extracted ${extracted.length} chars`, {
    htmlLength: target.innerHTML.length,
    textPreview: extracted.slice(0, 200)
  });
  return extracted;
}

async function confirmMessageSent(
  appKey: AppKey,
  selectors: SelectorGroup,
  snapshot: SubmissionSnapshot,
  inputElement?: HTMLElement
): Promise<SendConfirmationResult> {
  const deadline = Date.now() + SEND_CONFIRMATION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      if (inputElement && checkSubmissionSignals(selectors, inputElement, snapshot)) {
        log(appKey, "  Confirmed: submission signal (user message/stop/input/send)");
        return { sent: true, chatUrl: window.location.href };
      }
    } catch {
      // Non-fatal; fall through to other signals.
    }

    if (window.location.href !== snapshot.urlBeforeSend) {
      log(appKey, "  Confirmed: URL changed");
      return { sent: true, chatUrl: window.location.href };
    }

    await sleep(SEND_CONFIRMATION_POLL_MS);
  }

  log(appKey, "  FAILED: send confirmation timed out");
  return { sent: false, errorReason: "send_failed" };
}
