import { browser } from "wxt/browser";
import { getSupportedApp } from "../appRegistry";
import type { AppKey } from "../types";
import { DEFAULT_AUTOMATION_TIMEOUTS } from "./types";
import { loadSelectorConfig } from "./selectorConfig";
import type { ContentToBgMessage } from "./messages";

export interface DiagnosticResult {
  appKey: AppKey;
  tabId: number | null;
  tabUrl: string | null;
  contentReady: boolean;
  ready: boolean;
  errorReason?: string;
}

interface TabLoadResult {
  tabId: number;
  tabUrl: string | null;
  loaded: boolean;
  contentReady: boolean;
}

export async function runDiagnostic(
  appKey: AppKey,
  timeouts = DEFAULT_AUTOMATION_TIMEOUTS
): Promise<DiagnosticResult> {
  const app = getSupportedApp(appKey);

  let tabResult: TabLoadResult;
  try {
    tabResult = await openTabAndListenForReady(
      app.newChatUrl,
      timeouts.tabLoadMs,
      timeouts.contentReadyMs,
      appKey
    );
  } catch (error) {
    return {
      appKey,
      tabId: null,
      tabUrl: null,
      contentReady: false,
      ready: false,
      errorReason: error instanceof Error ? error.message : "tab_load_timeout"
    };
  }

  if (!tabResult.loaded) {
    return {
      appKey,
      tabId: tabResult.tabId,
      tabUrl: tabResult.tabUrl,
      contentReady: false,
      ready: false,
      errorReason: "tab_load_timeout"
    };
  }

  if (!tabResult.contentReady) {
    return {
      appKey,
      tabId: tabResult.tabId,
      tabUrl: tabResult.tabUrl,
      contentReady: false,
      ready: false,
      errorReason: "content_script_timeout"
    };
  }

  const selectors = loadSelectorConfig(appKey).selectors;
  const readiness = await sendDiagnosticCheck(appKey, tabResult.tabId, selectors);

  return {
    appKey,
    tabId: tabResult.tabId,
    tabUrl: tabResult.tabUrl,
    contentReady: true,
    ready: readiness.ready,
    errorReason: readiness.errorReason
  };
}

export async function openTabAndListenForReady(
  url: string,
  tabLoadTimeoutMs: number,
  contentReadyTimeoutMs: number,
  appKey: AppKey,
  focused = true
): Promise<TabLoadResult> {
  return new Promise<TabLoadResult>((resolve) => {
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

    // Listen for CONTENT_READY from the content script
    const messageListener = (message: ContentToBgMessage, sender: Browser.runtime.MessageSender) => {
      if (
        message.type === "CONTENT_READY" &&
        message.appKey === appKey &&
        sender.tab?.id === tabId
      ) {
        contentReady = true;
        // If tab is already loaded, we're done
        if (tabLoaded) {
          // Get the tab URL before resolving
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

    // Listen for tab load complete
    const tabListener = (
      updatedTabId: number,
      changeInfo: Browser.tabs.OnUpdatedInfo,
      updatedTab: Browser.tabs.Tab
    ) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        tabLoaded = true;
        // If content is already ready, we're done
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
        // If not ready yet, keep waiting for CONTENT_READY (readyTimer handles timeout)
      }
    };

    // Tab load timeout
    const loadTimer = setTimeout(() => {
      if (!tabLoaded) {
        finish();
      }
    }, tabLoadTimeoutMs);

    // Content ready timeout (starts after tab load timeout window)
    const readyTimer = setTimeout(() => {
      if (!contentReady) {
        finish();
      }
    }, contentReadyDeadline - Date.now());

    // Start listening BEFORE creating the tab
    browser.runtime.onMessage.addListener(messageListener);
    browser.tabs.onUpdated.addListener(tabListener);

    // Create the tab. When showAgentWindows is true the tab is active (visible);
    // when false it opens in the background so the user stays on the current tab.
    void browser.tabs.create({ url, active: focused }).then((tab) => {
      tabId = tab.id ?? null;

      // Fast path: check if tab is already complete
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

/**
 * Opens an agent tab in the same browser window with `active: true` so Chrome
 * gives the page full loading priority. The council runner switches back to
 * the user's tab after all agent tabs are created, so focus is only briefly
 * stolen during the setup phase. Background tabs (`active: false`) are
 * throttled by Chrome — heavy SPAs like Perplexity and Gemini do not finish
 * loading or render their input elements, causing content_script_timeout
 * or "input not found" errors.
 */
export async function openAgentTabInUnfocusedWindow(
  url: string,
  tabLoadTimeoutMs: number,
  contentReadyTimeoutMs: number,
  appKey: AppKey
): Promise<TabLoadResult> {
  return openTabAndListenForReady(url, tabLoadTimeoutMs, contentReadyTimeoutMs, appKey, true);
}

export async function openTabAndWaitForLoad(url: string, timeoutMs: number): Promise<Browser.tabs.Tab> {
  const tab = await browser.tabs.create({ url, active: true });

  return new Promise<Browser.tabs.Tab>((resolve, reject) => {
    let settled = false;

    const finish = (action: () => void, isReject = false): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      browser.tabs.onUpdated.removeListener(listener);
      if (isReject) reject(new Error("tab_load_timeout"));
      else action();
    };

    const timer = setTimeout(() => finish(() => {}, true), timeoutMs);

    const listener = (
      updatedTabId: number,
      changeInfo: Browser.tabs.OnUpdatedInfo,
      updatedTab: Browser.tabs.Tab
    ) => {
      if (updatedTabId === tab.id && changeInfo.status === "complete") {
        finish(() => resolve(updatedTab));
      }
    };

    browser.tabs.onUpdated.addListener(listener);

    if (tab.id !== undefined) {
      void browser.tabs.get(tab.id).then((current) => {
        if (current.status === "complete") {
          finish(() => resolve(current));
        }
      });
    }
  });
}

export async function waitForContentReady(
  appKey: AppKey,
  tabId: number,
  timeoutMs: number
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      browser.runtime.onMessage.removeListener(listener);
      resolve(false);
    }, timeoutMs);

    const listener = (message: ContentToBgMessage, sender: Browser.runtime.MessageSender) => {
      if (
        message.type === "CONTENT_READY" &&
        message.appKey === appKey &&
        sender.tab?.id === tabId
      ) {
        clearTimeout(timer);
        browser.runtime.onMessage.removeListener(listener);
        resolve(true);
      }
    };

    browser.runtime.onMessage.addListener(listener);
  });
}

async function sendDiagnosticCheck(
  appKey: AppKey,
  tabId: number,
  selectors: Awaited<ReturnType<typeof loadSelectorConfig>>["selectors"]
): Promise<{ ready: boolean; errorReason?: string }> {
  return new Promise<{ ready: boolean; errorReason?: string }>((resolve) => {
    const timer = setTimeout(() => {
      browser.runtime.onMessage.removeListener(listener);
      resolve({ ready: false, errorReason: "dom_error" });
    }, DEFAULT_AUTOMATION_TIMEOUTS.loginGraceMs + 5_000);

    const listener = (message: ContentToBgMessage, sender: Browser.runtime.MessageSender) => {
      if (
        message.type === "DIAGNOSTIC_RESULT" &&
        message.appKey === appKey &&
        sender.tab?.id === tabId
      ) {
        clearTimeout(timer);
        browser.runtime.onMessage.removeListener(listener);
        resolve({ ready: message.ready, errorReason: message.errorReason });
      }
    };

    browser.runtime.onMessage.addListener(listener);

    void browser.tabs
      .sendMessage(tabId, {
        type: "DIAGNOSTIC_CHECK",
        appKey,
        selectors
      })
      .catch(() => {
        clearTimeout(timer);
        browser.runtime.onMessage.removeListener(listener);
        resolve({ ready: false, errorReason: "content_script_timeout" });
      });
  });
}
