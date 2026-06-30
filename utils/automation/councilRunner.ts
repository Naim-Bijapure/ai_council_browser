import { browser } from "wxt/browser";
import { getSupportedApp } from "../appRegistry";
import { buildJudgePrompt } from "../judgePrompt";
import { saveSession } from "../history";
import {
  type ActiveCouncilSession,
  type AgentResult,
  type AppKey,
  type JudgeStep,
  type StoredCouncilSession
} from "../types";
import { openTabAndListenForReady, openAgentTabInUnfocusedWindow } from "./diagnostics";
import { getActiveWindowId, findMatchingTabInWindow, getActiveTabIdInWindow } from "./windowContext";
import type { BgToContentMessage, ContentToBgMessage } from "./messages";
import { loadSelectorConfig } from "./selectorConfig";
import {
  DEFAULT_AUTOMATION_TIMEOUTS,
  type AdapterResult,
  type AutomationTimeouts,
  type SendConfirmationResult
} from "./types";

export interface CouncilRunnerCallbacks {
  onUpdate: (session: ActiveCouncilSession) => void;
  onComplete: (session: ActiveCouncilSession) => void;
  isCancelled: () => boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ActiveRunState {
  sessionId: string;
  cancelled: boolean;
  timers: ReturnType<typeof setTimeout>[];
  tabListeners: Array<() => void>;
  messageListeners: Array<() => void>;
  agentTabIds: Map<AppKey, number>;
  judgeTabId: number | null;
  judgeWindowId: number | null;
}

export async function runCouncil(
  session: ActiveCouncilSession,
  callbacks: CouncilRunnerCallbacks,
  timeouts: AutomationTimeouts = DEFAULT_AUTOMATION_TIMEOUTS
): Promise<void> {
  // Capture the active window and tab before opening agent tabs, so the judge
  // opens in the same window and we can switch back to the user's tab after
  // agent injection.
  const judgeWindowId = await getActiveWindowId();
  const userTabId = judgeWindowId != null ? await getActiveTabIdInWindow(judgeWindowId) : null;

  const state: ActiveRunState = {
    sessionId: session.id,
    cancelled: false,
    timers: [],
    tabListeners: [],
    messageListeners: [],
    agentTabIds: new Map(),
    judgeTabId: null,
    judgeWindowId
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
      cleanup(state);
      return true;
    }
    return false;
  };

  const agentKeys = session.agentsUsed;

  try {
    if (checkCancelled()) return;

    // Step 1: Open all agent tabs in parallel (background tabs, no focus steal)
    const agentTabResults = await Promise.all(
      agentKeys.map((key) =>
        openAgentTabInUnfocusedWindow(
          getSupportedApp(key).newChatUrl,
          timeouts.tabLoadMs,
          timeouts.contentReadyMs,
          key
        ).catch(() => null)
      )
    );

    if (checkCancelled()) return;

    agentKeys.forEach((key, i) => {
      const result = agentTabResults[i];
      if (result?.tabId != null) {
        state.agentTabIds.set(key, result.tabId);
      }
    });

    // Switch back to the user's tab after all agent tabs are created.
    // Agent tabs were opened with active:true so Chrome prioritizes their
    // page loading; focus returns to the user now while we wait for
    // content scripts to report ready.
    if (userTabId != null) {
      try {
        await browser.tabs.update(userTabId, { active: true });
      } catch {
        // ignore — tab may be closed
      }
    }

    // Track first agent URL for agentTabUrl
    const firstLoaded = agentTabResults.find((r) => r?.tabUrl);
    if (firstLoaded) {
      session = update({ agentTabUrl: firstLoaded.tabUrl ?? null });
    }

    // Step 2: Check readiness for each agent
    const agentReadiness = agentKeys.map((key, i) => {
      const result = agentTabResults[i];

      if (!result?.loaded) {
        updateAgent(key, {
          status: "error",
          errorReason: "tab_load_timeout",
          completedAt: Date.now()
        });
        return null;
      }

      if (!result?.contentReady) {
        updateAgent(key, {
          status: "error",
          errorReason: "content_script_timeout",
          completedAt: Date.now()
        });
        return null;
      }

      const tabId = state.agentTabIds.get(key);
      if (tabId == null) {
        updateAgent(key, {
          status: "error",
          errorReason: "tab_load_timeout",
          completedAt: Date.now()
        });
        return null;
      }

      return { key, tabId };
    });

    if (checkCancelled()) return;

    // Step 3: Sequentially activate each agent tab, inject prompt, and send.
    // This gives each tab a brief moment of focus so execCommand/click work
    // reliably (Chrome throttles background tabs). Response detection continues
    // in the background via MutationObserver.
    const agentResultPromises: Promise<void>[] = [];

    for (const ready of agentReadiness) {
      if (!ready) continue;
      if (checkCancelled()) break;

      const { key, tabId } = ready;

      // Activate the agent tab so injection works without throttling
      try {
        await browser.tabs.update(tabId, { active: true });
      } catch {
        // ignore — tab might be closed
      }
      await sleep(500);

      if (checkCancelled()) break;

      updateAgent(key, { status: "injecting", startedAt: Date.now() });

      // Start the agent run (sends message + waits for result).
      // We don't await here — we want to move to the next agent.
      const resultPromise = sendAgentRun(key, tabId, session.prompt, timeouts, state).then((adapterResult) => {
        if (checkCancelled()) return;

        if (!adapterResult.success) {
          updateAgent(key, {
            status: "error",
            errorReason: adapterResult.errorReason ?? "dom_error",
            completedAt: Date.now()
          });
          return;
        }

        updateAgent(key, {
          status: "done",
          responseText: adapterResult.responseText ?? "",
          completedAt: adapterResult.completedAt ?? Date.now()
        });
      });

      agentResultPromises.push(resultPromise);

      // Wait for injection + send to complete before moving to next agent
      await sleep(2000);
    }

    // Step 4: Switch back to the user's tab
    if (userTabId != null) {
      try {
        await browser.tabs.update(userTabId, { active: true });
      } catch {
        // ignore
      }
    }

    // Step 5: Wait for all agent results (response detection runs in background)
    await Promise.all(agentResultPromises);
    if (checkCancelled()) return;

    // Step 4: Check if any agent succeeded
    const successfulAgents = session.agentResults.filter((r) => r.status === "done");
    if (successfulAgents.length === 0) {
      await finalizeSession(session, callbacks, state);

      // Override status to partial_failure (finalizeSession may set "error")
      session = update({
        status: "partial_failure",
        errorMessage: "All agents failed to produce a response",
        durationMs: Date.now() - session.timestamp
      });

      // Re-save as partial_failure
      const stored: StoredCouncilSession = {
        timestamp: session.timestamp,
        prompt: session.prompt,
        agentsUsed: session.agentsUsed,
        judgeApp: session.judgeApp,
        judgeChatUrl: null,
        agentResults: session.agentResults,
        judgeStep: session.judgeStep,
        agentTabUrl: session.agentTabUrl,
        status: "partial_failure",
        durationMs: session.durationMs,
        judgePrompt: session.judgePrompt,
        errorMessage: session.errorMessage
      };

      await saveSession(stored);
      callbacks.onUpdate(session);
      callbacks.onComplete(session);
      return;
    }

    // Step 5: Build judge prompt from successful agent responses
    const judgePrompt = buildJudgePrompt({
      prompt: session.prompt,
      agentResults: session.agentResults
    });

    session = update({ judgePrompt: judgePrompt.text });

    // Step 6: Open judge tab in active window, reusing current tab if it matches judge app
    const judgeKey = session.judgeApp;
    const judgeResult = await openJudgeTabAndListenForReady(
      judgeKey,
      state.judgeWindowId,
      timeouts.tabLoadMs,
      timeouts.contentReadyMs
    ).catch(() => null);

    if (checkCancelled()) return;

    state.judgeTabId = judgeResult?.tabId ?? null;

    if (!judgeResult?.loaded) {
      updateJudge({
        status: "error",
        errorReason: "tab_load_timeout",
        startedAt: Date.now(),
        completedAt: Date.now()
      });
      await finalizeSession(session, callbacks, state);
      return;
    }

    if (!judgeResult?.contentReady) {
      updateJudge({
        status: "error",
        errorReason: "content_script_timeout",
        startedAt: Date.now(),
        completedAt: Date.now()
      });
      await finalizeSession(session, callbacks, state);
      return;
    }

    if (checkCancelled()) return;

    updateJudge({ status: "injecting", startedAt: Date.now() });

    // Start URL capture listener BEFORE sending the judge prompt so SPA URL
    // changes are not missed.
    const judgeNewChatUrl = getSupportedApp(judgeKey).newChatUrl;
    const urlCaptureHandle = state.judgeTabId != null
      ? startJudgeUrlCapture(state.judgeTabId, judgeNewChatUrl, timeouts.urlCaptureMs, state)
      : null;

    const judgeSendResult = state.judgeTabId != null
      ? await sendJudgeRun(judgeKey, state.judgeTabId, judgePrompt.text, timeouts, state)
      : { sent: false, errorReason: "tab_load_timeout" as const };
    if (checkCancelled()) {
      urlCaptureHandle?.cancel();
      return;
    }

    if (!judgeSendResult.sent) {
      urlCaptureHandle?.cancel();
      updateJudge({
        status: "error",
        errorReason: judgeSendResult.errorReason ?? "send_failed",
        completedAt: Date.now()
      });
      await finalizeSession(session, callbacks, state);
      return;
    }

    updateJudge({ status: "sent", completedAt: Date.now() });

    // Step 7: Await the URL capture result (listener was attached before send)
    const judgeUrl = urlCaptureHandle ? await urlCaptureHandle.promise : null;
    if (checkCancelled()) return;

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
    }, timeouts.responseWaitMs);

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

async function sendJudgeRun(
  appKey: AppKey,
  tabId: number,
  prompt: string,
  timeouts: AutomationTimeouts,
  state: ActiveRunState
): Promise<SendConfirmationResult> {
  const selectors = loadSelectorConfig(appKey).selectors;

  return new Promise<SendConfirmationResult>((resolve) => {
    const timer = setTimeout(() => {
      removeMessageListener();
      resolve({ sent: false, errorReason: "timeout" });
    }, timeouts.responseWaitMs);

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

async function captureJudgeUrl(
  tabId: number,
  newChatUrl: string,
  timeoutMs: number,
  state: ActiveRunState
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let settled = false;

    const finish = (url: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(listener);
      state.tabListeners = state.tabListeners.filter((fn) => fn !== removeListener);
      resolve(url);
    };

    const removeListener = (): void => {
      browser.tabs.onUpdated.removeListener(listener);
    };

    const timer = setTimeout(() => {
      void browser.tabs.get(tabId).then((tab) => {
        const currentUrl = tab.url ?? "";
        if (currentUrl && currentUrl !== newChatUrl && !isNewChatUrl(currentUrl, newChatUrl)) {
          finish(currentUrl);
        } else {
          finish(null);
        }
      }).catch(() => finish(null));
    }, timeoutMs);

    const listener = (
      updatedTabId: number,
      changeInfo: Browser.tabs.OnUpdatedInfo,
      updatedTab: Browser.tabs.Tab
    ) => {
      if (updatedTabId === tabId && changeInfo.url) {
        const url = changeInfo.url;
        if (!isNewChatUrl(url, newChatUrl)) {
          finish(url);
        }
      }
    };

    state.tabListeners.push(removeListener);
    browser.tabs.onUpdated.addListener(listener);
  });
}

interface JudgeUrlCaptureHandle {
  promise: Promise<string | null>;
  cancel: () => void;
}

/**
 * Attaches the tabs.onUpdated listener for judge URL capture BEFORE the judge
 * prompt is sent, so SPA URL changes are not missed. Also reads the current
 * tab URL at attach time for race-safety (the URL may have already changed).
 *
 * Returns a handle whose `promise` resolves with the captured URL or null,
 * and a `cancel` function to clean up the listener early.
 */
function startJudgeUrlCapture(
  tabId: number,
  newChatUrl: string,
  timeoutMs: number,
  state: ActiveRunState
): JudgeUrlCaptureHandle {
  let settled = false;
  let resolveFn: (url: string | null) => void;

  const promise = new Promise<string | null>((resolve) => {
    resolveFn = resolve;
  });

  const finish = (url: string | null): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    browser.tabs.onUpdated.removeListener(listener);
    state.tabListeners = state.tabListeners.filter((fn) => fn !== removeListener);
    resolveFn(url);
  };

  const removeListener = (): void => {
    browser.tabs.onUpdated.removeListener(listener);
  };

  const timer = setTimeout(() => {
    void browser.tabs.get(tabId).then((tab) => {
      const currentUrl = tab.url ?? "";
      if (currentUrl && currentUrl !== newChatUrl && !isNewChatUrl(currentUrl, newChatUrl)) {
        finish(currentUrl);
      } else {
        finish(null);
      }
    }).catch(() => finish(null));
  }, timeoutMs);

  const listener = (
    updatedTabId: number,
    changeInfo: Browser.tabs.OnUpdatedInfo,
    updatedTab: Browser.tabs.Tab
  ) => {
    if (updatedTabId === tabId && changeInfo.url) {
      const url = changeInfo.url;
      if (!isNewChatUrl(url, newChatUrl)) {
        finish(url);
      }
    }
  };

  state.tabListeners.push(removeListener);
  browser.tabs.onUpdated.addListener(listener);

  // Race-safety: read current URL at attach time in case it already changed
  void browser.tabs.get(tabId).then((tab) => {
    const currentUrl = tab.url ?? "";
    if (currentUrl && currentUrl !== newChatUrl && !isNewChatUrl(currentUrl, newChatUrl)) {
      finish(currentUrl);
    }
  }).catch(() => {
    // ignore — listener and timer will handle it
  });

  const cancel = (): void => {
    finish(null);
  };

  return { promise, cancel };
}

async function openJudgeTabAndListenForReady(
  appKey: AppKey,
  targetWindowId: number | null,
  tabLoadTimeoutMs: number,
  contentReadyTimeoutMs: number
): Promise<{ tabId: number; tabUrl: string | null; loaded: boolean; contentReady: boolean }> {
  const newChatUrl = getSupportedApp(appKey).newChatUrl;

  // Use the window captured at the start of the council run, before agents opened.
  if (targetWindowId != null) {
    const { tabId: matchingTabId, matches } = await findMatchingTabInWindow(targetWindowId, appKey);
    if (matches && matchingTabId != null) {
      await browser.tabs.update(matchingTabId, { url: newChatUrl });
      return openTabAndListenForReadyOnExistingTab(matchingTabId, newChatUrl, tabLoadTimeoutMs, contentReadyTimeoutMs, appKey);
    }

    // No matching tab; create a new tab in the captured window
    return openTabAndListenForReadyInWindow(targetWindowId, newChatUrl, tabLoadTimeoutMs, contentReadyTimeoutMs, appKey);
  }

  // Fallback: open in a new window (previous behavior)
  return openTabAndListenForReady(newChatUrl, tabLoadTimeoutMs, contentReadyTimeoutMs, appKey);
}

function openTabAndListenForReadyOnExistingTab(
  tabId: number,
  newChatUrl: string,
  tabLoadTimeoutMs: number,
  contentReadyTimeoutMs: number,
  appKey: AppKey
): Promise<{ tabId: number; tabUrl: string | null; loaded: boolean; contentReady: boolean }> {
  return new Promise<{ tabId: number; tabUrl: string | null; loaded: boolean; contentReady: boolean }>((resolve) => {
    let settled = false;
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
        tabId,
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
          void browser.tabs.get(tabId).then((tab) => {
            settled = true;
            clearTimeout(loadTimer);
            clearTimeout(readyTimer);
            browser.tabs.onUpdated.removeListener(tabListener);
            browser.runtime.onMessage.removeListener(messageListener);
            resolve({
              tabId,
              tabUrl: tab.url ?? null,
              loaded: tabLoaded,
              contentReady
            });
          }).catch(() => finish());
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
            tabId,
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

    // The tab is already being navigated by the caller; handle fast path
    void browser.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete" && tab.url && tab.url !== newChatUrl && !isNewChatUrl(tab.url, newChatUrl)) {
        tabLoaded = true;
        if (contentReady) {
          settled = true;
          clearTimeout(loadTimer);
          clearTimeout(readyTimer);
          browser.tabs.onUpdated.removeListener(tabListener);
          browser.runtime.onMessage.removeListener(messageListener);
          resolve({
            tabId,
            tabUrl: tab.url ?? null,
            loaded: tabLoaded,
            contentReady
          });
        }
      }
    }).catch(() => finish());
  });
}

function openTabAndListenForReadyInWindow(
  windowId: number,
  url: string,
  tabLoadTimeoutMs: number,
  contentReadyTimeoutMs: number,
  appKey: AppKey
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

    void browser.tabs.create({ url, active: true, windowId }).then((tab) => {
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
  if (judgeSent) {
    status = session.judgeChatUrl ? "done" : "partial";
  } else if (anyAgentDone) {
    status = "partial_failure";
  } else {
    status = "error";
  }

  const finalSession: ActiveCouncilSession = {
    ...session,
    status,
    durationMs
  };

  const stored: StoredCouncilSession = {
    timestamp: finalSession.timestamp,
    prompt: finalSession.prompt,
    agentsUsed: finalSession.agentsUsed,
    judgeApp: finalSession.judgeApp,
    judgeChatUrl: finalSession.judgeChatUrl,
    agentResults: finalSession.agentResults,
    judgeStep: finalSession.judgeStep,
    agentTabUrl: finalSession.agentTabUrl,
    status: finalSession.status,
    durationMs: finalSession.durationMs,
    judgePrompt: finalSession.judgePrompt,
    errorMessage: finalSession.errorMessage
  };

  await saveSession(stored);
  callbacks.onUpdate(finalSession);
  callbacks.onComplete(finalSession);
}

function cleanup(state: ActiveRunState): void {
  state.timers.forEach((t) => clearTimeout(t));
  state.timers = [];
  state.tabListeners.forEach((fn) => fn());
  state.tabListeners = [];
  state.messageListeners.forEach((fn) => fn());
  state.messageListeners = [];
}
