import { browser } from "wxt/browser";
import { getSupportedApp } from "../appRegistry";
import { buildJudgePrompt } from "../judgePrompt";
import { saveSession } from "../history";
import { buildAuthorPrompt, buildRelayJudgePrompt, buildReviewerPrompt } from "../relayPrompt";
import { parseRelayResponse } from "../relayResponseParser";
import {
  type ActiveCouncilSession,
  type AgentResult,
  type AppKey,
  type JudgeStep,
  type RelayRole,
  toStoredSession
} from "../types";
import { openTabAndListenForReady } from "./diagnostics";
import { getActiveWindowId } from "./windowContext";
import type { BgToContentMessage, ContentToBgMessage } from "./messages";
import { loadSelectorConfig } from "./selectorConfig";
import {
  DEFAULT_AUTOMATION_TIMEOUTS,
  type AdapterResult,
  type AutomationTimeouts,
  type SendConfirmationResult
} from "./types";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Open a tab in the user's window and wait for it to load + content script
 * ready. Falls back to the current window if windowId is null.
 */
async function openCouncilTab(
  windowId: number | null,
  url: string,
  tabLoadTimeoutMs: number,
  contentReadyTimeoutMs: number,
  appKey: AppKey
): Promise<{ tabId: number; tabUrl: string | null; loaded: boolean; contentReady: boolean }> {
  if (windowId != null) {
    return openTabAndListenForReadyInWindow(
      windowId,
      url,
      tabLoadTimeoutMs,
      contentReadyTimeoutMs,
      appKey,
      true
    );
  }
  return openTabAndListenForReady(url, tabLoadTimeoutMs, contentReadyTimeoutMs, appKey, true);
}

export interface CouncilRunnerCallbacks {
  onUpdate: (session: ActiveCouncilSession) => void;
  onComplete: (session: ActiveCouncilSession) => void;
  isCancelled: () => boolean;
  getSkipAgent: () => AppKey | null;
  clearSkipAgent: () => void;
}

interface ActiveRunState {
  sessionId: string;
  cancelled: boolean;
  timers: ReturnType<typeof setTimeout>[];
  tabListeners: Array<() => void>;
  messageListeners: Array<() => void>;
  // The single council tab reused for all agents + judge.
  councilTabId: number | null;
  judgeTabId: number | null;
  judgeWindowId: number | null;
}

export async function runCouncil(
  session: ActiveCouncilSession,
  callbacks: CouncilRunnerCallbacks,
  timeouts: AutomationTimeouts = DEFAULT_AUTOMATION_TIMEOUTS,
  judgeWindowId?: number
): Promise<void> {
  // Use the provided windowId if available (from the side panel request),
  // otherwise fall back to getting the currently active window.
  const windowId = judgeWindowId ?? await getActiveWindowId();

  const state: ActiveRunState = {
    sessionId: session.id,
    cancelled: false,
    timers: [],
    tabListeners: [],
    messageListeners: [],
    councilTabId: null,
    judgeTabId: null,
    judgeWindowId: windowId
  };

  const update = (patch: Partial<ActiveCouncilSession>): ActiveCouncilSession => {
    session = { ...session, ...patch };
    callbacks.onUpdate(session);
    return session;
  };

  const updateAgent = (agentKey: AppKey, patch: Partial<AgentResult>): void => {
    session = {
      ...session,
      agentResults: session.agentResults.map((r) =>
        r.agentKey === agentKey ? { ...r, ...patch } : r
      )
    };
    callbacks.onUpdate(session);
  };

  const updateJudge = (patch: Partial<JudgeStep>): void => {
    session = {
      ...session,
      judgeStep: { ...session.judgeStep, ...patch }
    };
    callbacks.onUpdate(session);
  };

  const checkCancelled = (): boolean => {
    if (callbacks.isCancelled() || state.cancelled) {
      state.cancelled = true;
      cleanup(state);
      return true;
    }
    return false;
  };

  const agentKeys = session.agentsUsed;
  const isRelay = session.councilType === "relay";
  let currentDraft = "";

  try {
    if (checkCancelled()) return;

    // SINGLE-TAB SEQUENTIAL: One tab (councilTabId) is opened for the first
    // agent and reused for all subsequent agents + judge. The tab is always
    // foreground (active) so it gets full CPU — no background-tab throttling.
    // Each agent: navigate to URL → wait ready → inject → get full response →
    // navigate to next agent's URL. The tab stays open after the run so the
    // user can see the judge's response.
    for (let i = 0; i < agentKeys.length; i++) {
      const key = agentKeys[i];
      if (checkCancelled()) break;

      const relayRole: RelayRole | undefined = isRelay ? (i === 0 ? "author" : "reviewer") : undefined;
      const inputDraft = isRelay && i > 0 ? currentDraft : undefined;
      const agentPrompt = isRelay
        ? (i === 0
            ? buildAuthorPrompt(session.prompt)
            : buildReviewerPrompt({
                question: session.prompt,
                previousDraft: currentDraft,
                reviewerName: getSupportedApp(key).displayName,
                stepIndex: i + 1
              }).text)
        : session.prompt;

      if (isRelay && relayRole === "reviewer" && !currentDraft.trim()) {
        updateAgent(key, {
          status: "error",
          errorReason: "dom_error",
          relayRole,
          inputDraft: "",
          completedAt: Date.now()
        });
        continue;
      }

      updateAgent(key, {
        status: "injecting",
        startedAt: Date.now(),
        ...(relayRole ? { relayRole, inputDraft } : {})
      });

      const url = getSupportedApp(key).newChatUrl;

      let loaded = false;
      let contentReady = false;
      let tabUrl: string | null = null;

      if (state.councilTabId == null) {
        // First agent: open a new tab (active, foreground)
        const ready = await openCouncilTab(
          windowId,
          url,
          timeouts.tabLoadMs,
          timeouts.contentReadyMs,
          key
        ).catch(() => null);

        if (ready && ready.tabId >= 0) {
          state.councilTabId = ready.tabId;
          loaded = ready.loaded;
          contentReady = ready.contentReady;
          tabUrl = ready.tabUrl;
        }
      } else {
        // Subsequent agents: navigate the same council tab to the new URL
        const previousKey = agentKeys[i - 1];
        await sendCancelToTab(state.councilTabId, previousKey);
        try {
          await browser.tabs.update(state.councilTabId, { url });
        } catch {
          // tab may have been closed — will fail readiness below
        }
        const ready = await openTabAndListenForReadyOnExistingTab(
          state.councilTabId,
          url,
          timeouts.tabLoadMs,
          timeouts.contentReadyMs,
          key,
          true
        ).catch(() => null);
        loaded = ready?.loaded ?? false;
        contentReady = ready?.contentReady ?? false;
        tabUrl = ready?.tabUrl ?? null;
      }

      if (checkCancelled()) break;

      // Readiness gating
      if (state.councilTabId == null || !loaded) {
        updateAgent(key, { status: "error", errorReason: "tab_load_timeout", completedAt: Date.now() });
        continue;
      }
      if (!contentReady) {
        updateAgent(key, { status: "error", errorReason: "content_script_timeout", completedAt: Date.now() });
        continue;
      }

      if (!session.agentTabUrl && tabUrl) {
        session = update({ agentTabUrl: tabUrl });
      }

      // Send the prompt and WAIT for the full response, racing against a
      // skip signal so the user can abort a stuck/slow agent.
      updateAgent(key, {
        status: "waiting",
        ...(relayRole ? { relayRole, inputDraft } : {})
      });

      const adapterResult = await sendAgentRunWithSkip(
        key,
        state.councilTabId,
        agentPrompt,
        timeouts,
        state,
        callbacks
      );

      if (checkCancelled()) {
        break;
      }

      // Capture URL AFTER response completion to get the final conversation URL.
      // SPAs may change URLs multiple times during a conversation, so we read
      // the current URL only after the response is complete.
      let agentChatUrl: string | null = null;
      if (state.councilTabId != null && (adapterResult.success || adapterResult.skipped)) {
        try {
          const tab = await browser.tabs.get(state.councilTabId);
          const currentUrl = tab.url ?? "";
          // Only use the URL if it's different from the new-chat URL
          if (currentUrl && currentUrl !== url && !isNewChatUrl(currentUrl, url)) {
            agentChatUrl = currentUrl;
          }
        } catch {
          // Tab may have been closed — ignore
        }
      }

      if (adapterResult.skipped) {
        updateAgent(key, {
          status: "skipped",
          errorReason: "skipped",
          completedAt: Date.now(),
          chatUrl: agentChatUrl ?? undefined,
          ...(relayRole ? { relayRole, inputDraft } : {})
        });
        continue;
      }

      if (!adapterResult.success) {
        updateAgent(key, {
          status: "error",
          errorReason: adapterResult.errorReason ?? "dom_error",
          completedAt: Date.now(),
          chatUrl: agentChatUrl ?? undefined,
          ...(relayRole ? { relayRole, inputDraft } : {})
        });
        continue;
      }

      const responseText = adapterResult.responseText ?? "";
      if (isRelay && relayRole) {
        const parsed = parseRelayResponse(responseText, relayRole);
        currentDraft = parsed.revisedAnswerText;
        updateAgent(key, {
          status: "done",
          responseText,
          critiqueText: parsed.critiqueText,
          revisedAnswerText: parsed.revisedAnswerText,
          completedAt: adapterResult.completedAt ?? Date.now(),
          chatUrl: agentChatUrl ?? undefined,
          relayRole,
          inputDraft
        });
      } else {
        updateAgent(key, {
          status: "done",
          responseText,
          completedAt: adapterResult.completedAt ?? Date.now(),
          chatUrl: agentChatUrl ?? undefined
        });
      }
    }

    if (await abortIfCancelled(session, callbacks, state, checkCancelled)) return;

    if (isRelay) {
      session = update({ relayFinalDraft: currentDraft });
    }

    // Step 4: Check if we have enough to proceed to judge
    const successfulAgents = session.agentResults.filter((r) => r.status === "done");
    const canProceedToJudge = isRelay ? currentDraft.trim().length > 0 : successfulAgents.length > 0;
    if (!canProceedToJudge) {
      session = update({
        status: "partial_failure",
        errorMessage: isRelay
          ? "Relay chain produced no refined answer — judge step skipped"
          : "All agents failed to produce a response",
        durationMs: Date.now() - session.timestamp
      });

      await saveSession(toStoredSession(session));
      callbacks.onUpdate(session);
      callbacks.onComplete(session);
      cleanup(state);
      return;
    }

    // Step 5: Begin judge phase immediately so the UI does not appear stuck on
    // "Waiting…" while we build a potentially large relay judge prompt or
    // navigate the council tab to the judge app.
    session = update({ status: "judge_handoff" });
    updateJudge({ status: "injecting", startedAt: Date.now(), detail: "preparing_prompt" });

    await sleep(0);

    const judgePrompt = isRelay
      ? buildRelayJudgePrompt({
          prompt: session.prompt,
          agentResults: session.agentResults,
          finalDraft: currentDraft
        })
      : buildJudgePrompt({
          prompt: session.prompt,
          agentResults: session.agentResults
        });

    session = update({ judgePrompt: judgePrompt.text });
    updateJudge({ detail: "opening_tab" });

    // Step 6: Navigate the council tab to the judge URL (reuse same tab)
    const judgeKey = session.judgeApp;
    const judgeNewChatUrl = getSupportedApp(judgeKey).newChatUrl;
    const judgePhaseDeadline = Date.now() + JUDGE_PHASE_TIMEOUT_MS;

    if (state.councilTabId == null) {
      // Council tab was closed — open a new one
      const ready = await openCouncilTab(
        windowId,
        judgeNewChatUrl,
        timeouts.tabLoadMs,
        timeouts.contentReadyMs,
        judgeKey
      ).catch(() => null);
      state.councilTabId = ready && ready.tabId >= 0 ? ready.tabId : null;
      state.judgeTabId = state.councilTabId;

      if (!ready?.loaded) {
        updateJudge({
          status: "error",
          errorReason: "tab_load_timeout",
          completedAt: Date.now()
        });
        await finalizeSession(session, callbacks, state);
        return;
      }
      if (!ready.contentReady) {
        updateJudge({
          status: "error",
          errorReason: "content_script_timeout",
          completedAt: Date.now()
        });
        await finalizeSession(session, callbacks, state);
        return;
      }
    } else {
      // Navigate the existing council tab to the judge URL
      await sendCancelToTab(state.councilTabId, session.agentsUsed[session.agentsUsed.length - 1]);
      try {
        await browser.tabs.update(state.councilTabId, { url: judgeNewChatUrl });
      } catch {
        // tab may have been closed
      }
      const ready = await openTabAndListenForReadyOnExistingTab(
        state.councilTabId,
        judgeNewChatUrl,
        timeouts.tabLoadMs,
        timeouts.contentReadyMs,
        judgeKey,
        true
      ).catch(() => null);

      state.judgeTabId = state.councilTabId;

      if (!ready?.loaded) {
        updateJudge({
          status: "error",
          errorReason: "tab_load_timeout",
          completedAt: Date.now()
        });
        await finalizeSession(session, callbacks, state);
        return;
      }
      if (!ready?.contentReady) {
        updateJudge({
          status: "error",
          errorReason: "content_script_timeout",
          completedAt: Date.now()
        });
        await finalizeSession(session, callbacks, state);
        return;
      }
    }

    if (await abortIfCancelled(session, callbacks, state, checkCancelled)) return;

    if (Date.now() > judgePhaseDeadline) {
      updateJudge({
        status: "error",
        errorReason: "timeout",
        completedAt: Date.now()
      });
      await finalizeSession(session, callbacks, state);
      return;
    }

    // Judge phase already marked "injecting" above (includes tab prep).
    // We now perform the actual prompt injection + send confirmation.
    updateJudge({ detail: "sending" });
    const judgeSendResult = state.judgeTabId != null
      ? await sendJudgeRun(
          judgeKey,
          state.judgeTabId,
          judgePrompt.text,
          timeouts,
          state,
          judgePhaseDeadline
        )
      : { sent: false, errorReason: "tab_load_timeout" as const };
    if (await abortIfCancelled(session, callbacks, state, checkCancelled)) return;

    if (!judgeSendResult.sent) {
      updateJudge({
        status: "error",
        errorReason: judgeSendResult.errorReason ?? "send_failed",
        completedAt: Date.now()
      });
      await finalizeSession(session, callbacks, state);
      return;
    }

    updateJudge({ status: "sent", completedAt: Date.now() });

    // Capture URL AFTER response completion to get the final conversation URL.
    // SPAs may change URLs multiple times during a conversation, so we read
    // the current URL only after the response is complete.
    let judgeUrl: string | null = null;
    if (state.judgeTabId != null) {
      try {
        const tab = await browser.tabs.get(state.judgeTabId);
        const currentUrl = tab.url ?? "";
        // Only use the URL if it's different from the new-chat URL
        if (currentUrl && currentUrl !== judgeNewChatUrl && !isNewChatUrl(currentUrl, judgeNewChatUrl)) {
          judgeUrl = currentUrl;
        }
      } catch {
        // Tab may have been closed — ignore
      }
    }

    if (await abortIfCancelled(session, callbacks, state, checkCancelled)) return;

    session = update({ judgeChatUrl: judgeUrl });
    await finalizeSession(session, callbacks, state);
  } catch (error) {
    session = update({
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Unexpected error",
      durationMs: Date.now() - session.timestamp
    });
    callbacks.onComplete(session);
  } finally {
    cleanup(state);
  }
}

const JUDGE_SEND_TIMEOUT_MS = 90_000;
const JUDGE_PHASE_TIMEOUT_MS = 180_000;
const CONTENT_READY_NUDGE_INTERVAL_MS = 4_000;

async function sendCancelToTab(tabId: number, appKey: AppKey): Promise<void> {
  const message: BgToContentMessage = { type: "CANCEL", appKey };
  await browser.tabs.sendMessage(tabId, message).catch(() => {
    // Tab may have navigated away — content script not reachable.
  });
}

async function abortIfCancelled(
  session: ActiveCouncilSession,
  callbacks: CouncilRunnerCallbacks,
  state: ActiveRunState,
  checkCancelled: () => boolean
): Promise<boolean> {
  if (!checkCancelled()) return false;

  if (session.status === "running" || session.status === "judge_handoff") {
    const aborted: ActiveCouncilSession = {
      ...session,
      status: "cancelled",
      durationMs: Date.now() - session.timestamp,
      judgeStep:
        session.judgeStep.status === "sent"
          ? session.judgeStep
          : {
              ...session.judgeStep,
              status: "error",
              errorReason: "cancelled",
              completedAt: Date.now()
            }
    };
    await saveSession(toStoredSession(aborted));
    callbacks.onUpdate(aborted);
    callbacks.onComplete(aborted);
  }

  return true;
}

async function sendAgentRun(
  appKey: AppKey,
  tabId: number,
  prompt: string,
  timeouts: AutomationTimeouts,
  state: ActiveRunState
): Promise<AdapterResult> {
  const selectors = loadSelectorConfig(appKey).selectors;

  return new Promise<AdapterResult>((resolve) => {
    const timer = setTimeout(() => {
      removeMessageListener();
      resolve({ success: false, errorReason: "timeout" });
    }, timeouts.maxResponseWaitMs);

    const listener = (message: ContentToBgMessage, sender: Browser.runtime.MessageSender) => {
      if (message.type === "ADAPTER_RESULT" && message.appKey === appKey && sender.tab?.id === tabId) {
        clearTimeout(timer);
        removeMessageListener();
        resolve(message.result);
      }
    };

    const removeMessageListener = (): void => {
      browser.runtime.onMessage.removeListener(listener);
      state.messageListeners = state.messageListeners.filter((fn) => fn !== removeMessageListener);
    };

    state.messageListeners.push(removeMessageListener);
    browser.runtime.onMessage.addListener(listener);

    const bgMessage: BgToContentMessage = {
      type: "AGENT_RUN",
      appKey,
      prompt,
      selectors
    };

    void browser.tabs.sendMessage(tabId, bgMessage).catch(() => {
      clearTimeout(timer);
      removeMessageListener();
      resolve({ success: false, errorReason: "content_script_timeout" });
    });
  });
}

interface SkipAdapterResult extends AdapterResult {
  skipped?: boolean;
}

/**
 * Wraps sendAgentRun with a skip-signal poller. If the user clicks "Skip"
 * on the currently-running agent, this resolves early with `skipped: true`
 * instead of waiting for the agent's ADAPTER_RESULT.
 */
async function sendAgentRunWithSkip(
  appKey: AppKey,
  tabId: number,
  prompt: string,
  timeouts: AutomationTimeouts,
  state: ActiveRunState,
  callbacks: CouncilRunnerCallbacks
): Promise<SkipAdapterResult> {
  const skipPromise = new Promise<SkipAdapterResult>((resolve) => {
    const poll = (): void => {
      if (callbacks.isCancelled()) {
        resolve({ success: false, errorReason: "cancelled", skipped: true, completedAt: Date.now() });
        return;
      }
      const skipKey = callbacks.getSkipAgent();
      if (skipKey === appKey) {
        callbacks.clearSkipAgent();
        resolve({ success: false, errorReason: "skipped", skipped: true, completedAt: Date.now() });
        return;
      }
      setTimeout(poll, 500);
    };
    setTimeout(poll, 500);
  });

  const result = await Promise.race([
    sendAgentRun(appKey, tabId, prompt, timeouts, state),
    skipPromise
  ]);

  return result as SkipAdapterResult;
}

async function sendJudgeRun(
  appKey: AppKey,
  tabId: number,
  prompt: string,
  timeouts: AutomationTimeouts,
  state: ActiveRunState,
  deadlineMs?: number
): Promise<SendConfirmationResult> {
  const selectors = loadSelectorConfig(appKey).selectors;
  const waitMs = deadlineMs
    ? Math.max(5_000, Math.min(JUDGE_SEND_TIMEOUT_MS, deadlineMs - Date.now()))
    : JUDGE_SEND_TIMEOUT_MS;

  return new Promise<SendConfirmationResult>((resolve) => {
    const timer = setTimeout(() => {
      removeMessageListener();
      resolve({ sent: false, errorReason: "timeout" });
    }, waitMs);

    const listener = (message: ContentToBgMessage, sender: Browser.runtime.MessageSender) => {
      if (message.type === "SEND_CONFIRMED" && message.appKey === appKey && sender.tab?.id === tabId) {
        clearTimeout(timer);
        removeMessageListener();
        resolve(message.result);
      }
    };

    const removeMessageListener = (): void => {
      browser.runtime.onMessage.removeListener(listener);
      state.messageListeners = state.messageListeners.filter((fn) => fn !== removeMessageListener);
    };

    state.messageListeners.push(removeMessageListener);
    browser.runtime.onMessage.addListener(listener);

    const bgMessage: BgToContentMessage = {
      type: "JUDGE_RUN",
      appKey,
      prompt,
      selectors
    };

    void browser.tabs.sendMessage(tabId, bgMessage).catch(() => {
      clearTimeout(timer);
      removeMessageListener();
      resolve({ sent: false, errorReason: "content_script_timeout" });
    });
  });
}

function isOnTargetChatUrl(tabUrl: string | undefined, newChatUrl: string): boolean {
  if (!tabUrl) return false;
  if (tabUrl === newChatUrl || isNewChatUrl(tabUrl, newChatUrl)) return true;

  try {
    const parsed = new URL(tabUrl);
    const target = new URL(newChatUrl);
    // SPAs often redirect / to /chat or similar after load — same origin is enough
    // once navigation to the judge/agent app has completed.
    return parsed.origin === target.origin;
  } catch {
    return false;
  }
}

async function nudgeContentReady(tabId: number, appKey: AppKey): Promise<void> {
  const message: BgToContentMessage = { type: "NUDGE_READY", appKey };
  await browser.tabs.sendMessage(tabId, message).catch(() => {
    // Content script may not be injected yet.
  });
}

function openTabAndListenForReadyOnExistingTab(
  tabId: number,
  newChatUrl: string,
  tabLoadTimeoutMs: number,
  contentReadyTimeoutMs: number,
  appKey: AppKey,
  focused: boolean = true
): Promise<{ tabId: number; tabUrl: string | null; loaded: boolean; contentReady: boolean }> {
  return new Promise<{ tabId: number; tabUrl: string | null; loaded: boolean; contentReady: boolean }>((resolve) => {
    let settled = false;
    let tabLoaded = false;
    let contentReady = false;

    const contentReadyDeadline = Date.now() + tabLoadTimeoutMs + contentReadyTimeoutMs;

    const resolveReady = (tabUrl: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(loadTimer);
      clearTimeout(readyTimer);
      clearTimeout(absoluteTimer);
      clearInterval(nudgeTimer);
      browser.tabs.onUpdated.removeListener(tabListener);
      browser.runtime.onMessage.removeListener(messageListener);
      resolve({
        tabId,
        tabUrl,
        loaded: tabLoaded,
        contentReady
      });
    };

    const finish = (): void => {
      if (settled) return;
      void browser.tabs.get(tabId).then((tab) => {
        resolveReady(tab.url ?? null);
      }).catch(() => {
        resolveReady(null);
      });
    };

    const maybeResolve = (): void => {
      if (!tabLoaded || !contentReady || settled) return;
      void browser.tabs.get(tabId).then((tab) => {
        if (!isOnTargetChatUrl(tab.url, newChatUrl)) return;
        resolveReady(tab.url ?? null);
      }).catch(() => finish());
    };

    const messageListener = (message: ContentToBgMessage, sender: Browser.runtime.MessageSender) => {
      if (
        message.type === "CONTENT_READY" &&
        message.appKey === appKey &&
        sender.tab?.id === tabId
      ) {
        void browser.tabs.get(tabId).then((tab) => {
          if (!isOnTargetChatUrl(tab.url, newChatUrl)) return;
          contentReady = true;
          maybeResolve();
        }).catch(() => {
          // Ignore transient tab read failures — timeout will handle it.
        });
      }
    };

    const tabListener = (
      updatedTabId: number,
      changeInfo: Browser.tabs.OnUpdatedInfo,
      updatedTab: Browser.tabs.Tab
    ) => {
      if (updatedTabId !== tabId) return;

      if (changeInfo.url) {
        // A navigation started — discard any CONTENT_READY from the previous page.
        contentReady = false;
      }

      if (changeInfo.status === "complete" && isOnTargetChatUrl(updatedTab.url, newChatUrl)) {
        tabLoaded = true;
        maybeResolve();
      }
    };

    const loadTimer = setTimeout(() => {
      if (!tabLoaded) {
        finish();
      }
    }, tabLoadTimeoutMs);

    const readyTimer = setTimeout(() => {
      if (!contentReady) {
        finish();
      }
    }, contentReadyDeadline - Date.now());

    const absoluteTimer = setTimeout(() => {
      finish();
    }, contentReadyDeadline - Date.now() + 5_000);

    const nudgeTimer = setInterval(() => {
      if (settled || contentReady) return;
      if (tabLoaded) {
        void nudgeContentReady(tabId, appKey);
      }
    }, CONTENT_READY_NUDGE_INTERVAL_MS);

    browser.runtime.onMessage.addListener(messageListener);
    browser.tabs.onUpdated.addListener(tabListener);

    // Fast path: tab is already on the target URL (no navigation needed).
    void browser.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete" && isOnTargetChatUrl(tab.url, newChatUrl)) {
        tabLoaded = true;
        maybeResolve();
      }
    }).catch(() => finish());
  });
}

function openTabAndListenForReadyInWindow(
  windowId: number,
  url: string,
  tabLoadTimeoutMs: number,
  contentReadyTimeoutMs: number,
  appKey: AppKey,
  focused: boolean = true
): Promise<{ tabId: number; tabUrl: string | null; loaded: boolean; contentReady: boolean }> {
  return new Promise<{ tabId: number; tabUrl: string | null; loaded: boolean; contentReady: boolean }>((resolve) => {
    let settled = false;
    let tabId: number | null = null;
    let tabLoaded = false;
    let contentReady = false;

    const contentReadyDeadline = Date.now() + tabLoadTimeoutMs + contentReadyTimeoutMs;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(loadTimer);
      clearTimeout(readyTimer);
      browser.tabs.onUpdated.removeListener(tabListener);
      browser.runtime.onMessage.removeListener(messageListener);
      resolve({
        tabId: tabId ?? -1,
        tabUrl: null,
        loaded: tabLoaded,
        contentReady
      });
    };

    const messageListener = (message: ContentToBgMessage, sender: Browser.runtime.MessageSender) => {
      if (
        message.type === "CONTENT_READY" &&
        message.appKey === appKey &&
        sender.tab?.id === tabId
      ) {
        contentReady = true;
        if (tabLoaded) {
          if (tabId !== null) {
            void browser.tabs.get(tabId).then((tab) => {
              settled = true;
              clearTimeout(loadTimer);
              clearTimeout(readyTimer);
              browser.tabs.onUpdated.removeListener(tabListener);
              browser.runtime.onMessage.removeListener(messageListener);
              resolve({
                tabId: tabId ?? -1,
                tabUrl: tab.url ?? null,
                loaded: tabLoaded,
                contentReady
              });
            }).catch(() => finish());
          } else {
            finish();
          }
        }
      }
    };

    const tabListener = (
      updatedTabId: number,
      changeInfo: Browser.tabs.OnUpdatedInfo,
      updatedTab: Browser.tabs.Tab
    ) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        tabLoaded = true;
        if (contentReady) {
          settled = true;
          clearTimeout(loadTimer);
          clearTimeout(readyTimer);
          browser.tabs.onUpdated.removeListener(tabListener);
          browser.runtime.onMessage.removeListener(messageListener);
          resolve({
            tabId: tabId ?? -1,
            tabUrl: updatedTab.url ?? null,
            loaded: tabLoaded,
            contentReady
          });
        }
      }
    };

    const loadTimer = setTimeout(() => {
      if (!tabLoaded) {
        finish();
      }
    }, tabLoadTimeoutMs);

    const readyTimer = setTimeout(() => {
      if (!contentReady) {
        finish();
      }
    }, contentReadyDeadline - Date.now());

    browser.runtime.onMessage.addListener(messageListener);
    browser.tabs.onUpdated.addListener(tabListener);

    void browser.tabs.create({ url, active: focused, windowId }).then((tab) => {
      tabId = tab.id ?? null;

      if (tab.status === "complete") {
        tabLoaded = true;
        if (contentReady) {
          settled = true;
          clearTimeout(loadTimer);
          clearTimeout(readyTimer);
          browser.tabs.onUpdated.removeListener(tabListener);
          browser.runtime.onMessage.removeListener(messageListener);
          resolve({
            tabId: tabId ?? -1,
            tabUrl: tab.url ?? null,
            loaded: tabLoaded,
            contentReady
          });
        }
      }
    });
  });
}

function isNewChatUrl(url: string, newChatUrl: string): boolean {
  if (url === newChatUrl) return true;
  try {
    const parsed = new URL(url);
    const newParsed = new URL(newChatUrl);
    return parsed.origin === newParsed.origin && parsed.pathname === newParsed.pathname && !parsed.search;
  } catch {
    return false;
  }
}

async function finalizeSession(
  session: ActiveCouncilSession,
  callbacks: CouncilRunnerCallbacks,
  state: ActiveRunState
): Promise<void> {
  const durationMs = Date.now() - session.timestamp;
  const anyAgentDone = session.agentResults.some((r) => r.status === "done");
  const judgeSent = session.judgeStep.status === "sent";

  let status: ActiveCouncilSession["status"];
  let errorMessage = session.errorMessage;

  if (judgeSent) {
    status = session.judgeChatUrl ? "done" : "partial";
  } else if (anyAgentDone) {
    status = "partial_failure";
    if (!errorMessage && session.judgeStep.status === "error") {
      errorMessage = session.judgeStep.errorReason
        ? `Judge step failed: ${session.judgeStep.errorReason}`
        : "Judge step failed";
    }
  } else {
    status = "error";
  }

  const finalSession: ActiveCouncilSession = {
    ...session,
    status,
    durationMs,
    ...(errorMessage ? { errorMessage } : {})
  };

  await saveSession(toStoredSession(finalSession));
  callbacks.onUpdate(finalSession);
  callbacks.onComplete(finalSession);
}

/**
 * Cleans up listeners and closes the council tab on cancellation.
 * On normal completion the council tab is left open so the user can see
 * the judge's response.
 */
function cleanup(state: ActiveRunState): void {
  state.timers.forEach((t) => clearTimeout(t));
  state.timers = [];
  state.tabListeners.forEach((fn) => fn());
  state.tabListeners = [];
  state.messageListeners.forEach((fn) => fn());
  state.messageListeners = [];
  // Only close the council tab on cancellation — on normal completion the
  // tab stays open so the user can see the judge's response.
  if (state.cancelled && state.councilTabId != null) {
    const tabId = state.councilTabId;
    state.councilTabId = null;
    void browser.tabs.remove(tabId).catch(() => {
      // already closed — ignore
    });
  }
}
