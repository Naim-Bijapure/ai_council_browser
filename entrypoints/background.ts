import { browser } from "wxt/browser";
import { getSupportedApp } from "../utils/appRegistry";
import { openTabAndListenForReady, runDiagnostic } from "../utils/automation/diagnostics";
import { loadSelectorConfig } from "../utils/automation/selectorConfig";
import { runCouncil } from "../utils/automation/councilRunner";
import type { ContentToBgMessage } from "../utils/automation/messages";
import type { ProbeMode, ProbeResult as AutomationProbeResult } from "../utils/automation/types";
import { DEFAULT_AUTOMATION_TIMEOUTS } from "../utils/automation/types";
import { getPreferences, savePreferences } from "../utils/preferences";
import { clearSessions, listSessions } from "../utils/history";
import {
  MAX_USER_PROMPT_LENGTH,
  type ActiveCouncilSession,
  type AgentResult,
  type AppKey,
  type CouncilSnapshot,
  type DiagnosticReport,
  type JudgeStep,
  type PanelRequest,
  type PanelResponse,
  type RunCouncilRequest,
  type StoredCouncilSession
} from "../utils/types";

let activeSession: ActiveCouncilSession | null = null;
let cancelFlag = false;

export default defineBackground(() => {
  void configureSidePanel();

  // PRODUCTION ONLY: content scripts are declared in the manifest, so any
  // programmatically-registered scripts are stale leftovers from older builds
  // (their registrations PERSIST across reloads and would inject a second,
  // stale copy into every page — duplicating the prompt). Remove them.
  //
  // In DEV, WXT does NOT declare content scripts in the manifest — it registers
  // them itself via chrome.scripting for HMR. Running the cleanup there would
  // unregister WXT's own dev content scripts, so they'd stop injecting and
  // agents would fail randomly. So we skip it entirely in dev.
  if (!import.meta.env.DEV) {
    void cleanupStaleContentScripts();
  }

  browser.runtime.onMessage.addListener((message) => {
    return handlePanelMessage(message as PanelRequest);
  });
});

async function cleanupStaleContentScripts(): Promise<void> {
  try {
    if (!browser.scripting?.getRegisteredContentScripts) return;

    const registered = await browser.scripting.getRegisteredContentScripts();
    if (registered.length === 0) return;

    await browser.scripting.unregisterContentScripts({
      ids: registered.map((s) => s.id)
    });
    console.log(
      "[AI Council] Removed stale programmatically-registered content scripts:",
      registered.map((s) => s.id)
    );
  } catch (error) {
    // Silently ignore — manifest-declared content scripts are unaffected.
  }
}

async function configureSidePanel(): Promise<void> {
  try {
    await browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("Unable to configure side panel action behavior", error);
  }
}

async function handlePanelMessage(message: PanelRequest): Promise<PanelResponse> {
  switch (message.type) {
    case "GET_BOOTSTRAP": {
      const [preferences, history] = await Promise.all([getPreferences(), listSessions()]);
      return { ok: true, preferences, history, snapshot: getSnapshot() };
    }

    case "SAVE_PREFERENCES": {
      const preferences = await savePreferences(message.preferences);
      return { ok: true, preferences };
    }

    case "RUN_COUNCIL":
      return startCouncil(message.request);

    case "CANCEL_COUNCIL":
      return cancelCouncil();

    case "NEW_QUESTION":
      activeSession = null;
      cancelFlag = false;
      await broadcastSnapshot();
      return { ok: true, snapshot: getSnapshot() };

    case "SWITCH_TO_JUDGE":
      return switchToJudge();

    case "GET_HISTORY":
      return { ok: true, history: await listSessions() };

    case "CLEAR_HISTORY":
      await clearSessions();
      return { ok: true, history: [] };

    case "RUN_DIAGNOSTIC":
      return runDiagnostics(message.agentKeys);

    case "RUN_PROBE":
      return runProbe(message.appKey, message.mode);

    default:
      return { ok: false, error: "Unknown request" };
  }
}

async function startCouncil(request: RunCouncilRequest): Promise<PanelResponse> {
  const validationError = validateRunRequest(request);

  if (validationError) {
    return { ok: false, error: validationError, snapshot: getSnapshot() };
  }

  if (activeSession?.status === "running") {
    return { ok: false, error: "A council session is already running", snapshot: getSnapshot() };
  }

  const agentKeys = request.agentKeys;
  const judgeKey = request.judgeKey;

  const judgeStep: JudgeStep = {
    status: "pending",
    startedAt: null,
    completedAt: null
  };

  activeSession = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    prompt: request.prompt.trim(),
    agentsUsed: agentKeys,
    judgeApp: judgeKey,
    judgeChatUrl: null,
    agentResults: agentKeys.map(createPendingAgentResult),
    judgeStep,
    agentTabUrl: null,
    status: "running",
    durationMs: 0
  };

  cancelFlag = false;

  await broadcastSnapshot();

  void runCouncil(activeSession, {
    onUpdate: (session) => {
      activeSession = session;
      void broadcastSnapshot();
    },
    onComplete: (session) => {
      activeSession = session;
      void broadcastSnapshot();
    },
    isCancelled: () => cancelFlag
  });

  return { ok: true, snapshot: getSnapshot() };
}

function validateRunRequest(request: RunCouncilRequest): string | null {
  if (!request.prompt.trim()) {
    return "Please enter a prompt";
  }

  if (request.prompt.length > MAX_USER_PROMPT_LENGTH) {
    return "Prompt is too long (max 10,000 characters)";
  }

  if (!request.agentKeys || request.agentKeys.length === 0) {
    return "Please select at least one agent";
  }

  if (!request.judgeKey) {
    return "Please select a judge";
  }

  return null;
}

function createPendingAgentResult(agentKey: AppKey): AgentResult {
  return {
    agentKey,
    status: "pending",
    responseText: "",
    startedAt: Date.now(),
    completedAt: null
  };
}

async function cancelCouncil(): Promise<PanelResponse> {
  if (!activeSession || activeSession.status !== "running") {
    return { ok: true, snapshot: getSnapshot() };
  }

  cancelFlag = true;

  activeSession = {
    ...activeSession,
    status: "cancelled",
    durationMs: Date.now() - activeSession.timestamp,
    judgeChatUrl: null,
    agentResults: activeSession.agentResults.map((result) =>
      ["done", "timeout", "error"].includes(result.status)
        ? result
        : {
            ...result,
            status: "error",
            errorReason: "cancelled",
            completedAt: Date.now()
          }
    ),
    judgeStep:
      activeSession.judgeStep.status === "sent"
        ? activeSession.judgeStep
        : {
            ...activeSession.judgeStep,
            status: "error",
            errorReason: "cancelled",
            completedAt: Date.now()
          }
  };

  await saveCancelledSession();
  const history = await listSessions();
  activeSession = null;
  await broadcastSnapshot();

  return { ok: true, snapshot: getSnapshot(), history };
}

async function saveCancelledSession(): Promise<void> {
  if (!activeSession) return;

  const stored: StoredCouncilSession = {
    timestamp: activeSession.timestamp,
    prompt: activeSession.prompt,
    agentsUsed: activeSession.agentsUsed,
    judgeApp: activeSession.judgeApp,
    judgeChatUrl: activeSession.judgeChatUrl,
    agentResults: activeSession.agentResults,
    judgeStep: activeSession.judgeStep,
    agentTabUrl: activeSession.agentTabUrl,
    status: activeSession.status,
    durationMs: activeSession.durationMs,
    judgePrompt: activeSession.judgePrompt,
    errorMessage: activeSession.errorMessage
  };

  const { saveSession } = await import("../utils/history");
  await saveSession(stored);
}

async function switchToJudge(): Promise<PanelResponse> {
  if (!activeSession?.judgeChatUrl) {
    return { ok: false, error: "Judge tab is unavailable", snapshot: getSnapshot() };
  }

  await browser.tabs.create({ url: activeSession.judgeChatUrl, active: true });
  return { ok: true, snapshot: getSnapshot() };
}

function getSnapshot(): CouncilSnapshot {
  if (!activeSession) {
    return { state: "idle", session: null };
  }
  return { state: "active", session: activeSession };
}

async function broadcastSnapshot(): Promise<void> {
  try {
    await browser.runtime.sendMessage({
      type: "SESSION_UPDATED",
      snapshot: getSnapshot()
    });
  } catch {
    // No side panel listener is active yet.
  }
}

async function runDiagnostics(agentKeys: AppKey[]): Promise<PanelResponse> {
  const results = await Promise.all(
    agentKeys.map((key) => runDiagnostic(key))
  );

  const report: DiagnosticReport = {};
  for (let i = 0; i < agentKeys.length; i++) {
    report[agentKeys[i]] = {
      ready: results[i].ready,
      errorReason: results[i].errorReason,
      tabUrl: results[i].tabUrl
    };
  }

  return { ok: true, diagnostic: report, snapshot: getSnapshot() };
}

async function runProbe(appKey: AppKey, mode: ProbeMode): Promise<PanelResponse> {
  const app = getSupportedApp(appKey);

  const tabResult = await openTabAndListenForReady(
    app.newChatUrl,
    DEFAULT_AUTOMATION_TIMEOUTS.tabLoadMs,
    DEFAULT_AUTOMATION_TIMEOUTS.contentReadyMs,
    appKey,
    true
  );

  if (!tabResult.loaded || !tabResult.contentReady) {
    return {
      ok: false,
      error: tabResult.loaded ? "content_script_timeout" : "tab_load_timeout",
      errorDetail: tabResult.tabUrl
        ? `tab opened at ${tabResult.tabUrl} but content script did not respond — reload the extension and reopen the tab`
        : `tab did not load ${app.newChatUrl}`,
      snapshot: getSnapshot()
    };
  }

  const tabId = tabResult.tabId;
  if (tabId == null) {
    return { ok: false, error: "tab_load_timeout", snapshot: getSnapshot() };
  }

  const config = await loadSelectorConfig(appKey);

  const probeResult = await sendProbeRun(appKey, tabId, config.selectors, mode);

  return { ok: true, probe: probeResult, snapshot: getSnapshot() };
}

async function sendProbeRun(
  appKey: AppKey,
  tabId: number,
  selectors: Awaited<ReturnType<typeof loadSelectorConfig>>["selectors"],
  mode: ProbeMode
): Promise<AutomationProbeResult> {
  return new Promise<AutomationProbeResult>((resolve) => {
    const timeoutMs = mode === "live" ? 60_000 : 15_000;
    const timer = setTimeout(() => {
      browser.runtime.onMessage.removeListener(listener);
      resolve({
        appKey,
        mode,
        steps: [{
          field: "input",
          status: "fail",
          detail: "probe timed out"
        }],
        durationMs: 0
      });
    }, timeoutMs);

    const listener = (message: ContentToBgMessage, sender: Browser.runtime.MessageSender) => {
      if (
        message.type === "PROBE_RESULT" &&
        message.appKey === appKey &&
        sender.tab?.id === tabId
      ) {
        clearTimeout(timer);
        browser.runtime.onMessage.removeListener(listener);
        resolve(message.result);
      }
    };

    browser.runtime.onMessage.addListener(listener);

    void browser.tabs
      .sendMessage(tabId, {
        type: "PROBE_RUN",
        appKey,
        selectors,
        mode
      })
      .catch(() => {
        clearTimeout(timer);
        browser.runtime.onMessage.removeListener(listener);
        resolve({
          appKey,
          mode,
          steps: [{
            field: "input",
            status: "fail",
            detail: "failed to send PROBE_RUN message"
          }],
          durationMs: 0
        });
      });
  });
}
