import { browser } from "wxt/browser";
import { getSupportedApp } from "../utils/appRegistry";
import { buildJudgePrompt } from "../utils/judgePrompt";
import { getPreferences, savePreferences } from "../utils/preferences";
import { clearSessions, listSessions, saveSession } from "../utils/history";
import {
  MAX_USER_PROMPT_LENGTH,
  type ActiveCouncilSession,
  type AgentResult,
  type AppKey,
  type CouncilSnapshot,
  type PanelRequest,
  type PanelResponse,
  type RunCouncilRequest,
  type StoredCouncilSession
} from "../utils/types";

let activeSession: ActiveCouncilSession | null = null;
let activeTimers: ReturnType<typeof setTimeout>[] = [];

export default defineBackground(() => {
  void configureSidePanel();

  browser.runtime.onMessage.addListener((message) => {
    return handlePanelMessage(message as PanelRequest);
  });
});

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
      clearTimers();
      await broadcastSnapshot();
      return { ok: true, snapshot: getSnapshot() };

    case "SWITCH_TO_JUDGE":
      return switchToJudge();

    case "GET_HISTORY":
      return { ok: true, history: await listSessions() };

    case "CLEAR_HISTORY":
      await clearSessions();
      return { ok: true, history: [] };

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

  const timestamp = Date.now();
  activeSession = {
    id: crypto.randomUUID(),
    timestamp,
    prompt: request.prompt.trim(),
    agentsUsed: request.agentKeys,
    judgeApp: request.judgeKey,
    judgeChatUrl: null,
    agentResults: request.agentKeys.map(createPendingAgentResult),
    status: "running",
    durationMs: 0
  };

  await savePreferences({
    selectedAgentKeys: request.agentKeys,
    judgeKey: request.judgeKey
  });
  await broadcastSnapshot();
  runDemoAgents(activeSession.id);

  return { ok: true, snapshot: getSnapshot() };
}

function validateRunRequest(request: RunCouncilRequest): string | null {
  if (!request.prompt.trim()) {
    return "Please enter a prompt";
  }

  if (request.agentKeys.length < 1) {
    return "Select at least one agent";
  }

  if (!request.judgeKey) {
    return "Select a judge";
  }

  if (request.prompt.length > MAX_USER_PROMPT_LENGTH) {
    return "Prompt is too long (max 10,000 characters)";
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

function runDemoAgents(sessionId: string): void {
  clearTimers();

  activeSession?.agentsUsed.forEach((agentKey, index) => {
    scheduleDemoStatus(sessionId, agentKey, "injecting", 350 + index * 450);
    scheduleDemoStatus(sessionId, agentKey, "waiting", 900 + index * 450);
    scheduleDemoCompletion(sessionId, agentKey, 1_900 + index * 650);
  });
}

function scheduleDemoStatus(
  sessionId: string,
  agentKey: AppKey,
  status: "injecting" | "waiting",
  delay: number
): void {
  activeTimers.push(
    setTimeout(() => {
      if (!isActiveSession(sessionId)) {
        return;
      }

      updateAgent(agentKey, { status });
      void broadcastSnapshot();
    }, delay)
  );
}

function scheduleDemoCompletion(sessionId: string, agentKey: AppKey, delay: number): void {
  activeTimers.push(
    setTimeout(() => {
      if (!isActiveSession(sessionId) || !activeSession) {
        return;
      }

      const appName = getSupportedApp(agentKey).displayName;
      updateAgent(agentKey, {
        status: "done",
        responseText: `Demo response from ${appName}: this is a placeholder answer for "${activeSession.prompt}". Real tab automation will replace this in the next implementation round.`,
        completedAt: Date.now()
      });

      void broadcastSnapshot();
      void maybeFinishSession(sessionId);
    }, delay)
  );
}

function updateAgent(agentKey: AppKey, patch: Partial<AgentResult>): void {
  if (!activeSession) {
    return;
  }

  activeSession = {
    ...activeSession,
    agentResults: activeSession.agentResults.map((result) =>
      result.agentKey === agentKey ? { ...result, ...patch } : result
    )
  };
}

async function maybeFinishSession(sessionId: string): Promise<void> {
  if (!isActiveSession(sessionId) || !activeSession) {
    return;
  }

  const allResolved = activeSession.agentResults.every((result) =>
    ["done", "timeout", "error"].includes(result.status)
  );

  if (!allResolved) {
    return;
  }

  const hasSuccessfulAgent = activeSession.agentResults.some((result) => result.status === "done");
  const durationMs = Date.now() - activeSession.timestamp;

  if (!hasSuccessfulAgent) {
    activeSession = {
      ...activeSession,
      status: "partial_failure",
      durationMs,
      judgeChatUrl: null
    };
    await saveActiveSession();
    await broadcastSnapshot();
    return;
  }

  const judgePrompt = buildJudgePrompt({
    prompt: activeSession.prompt,
    agentResults: activeSession.agentResults
  });

  activeSession = {
    ...activeSession,
    status: "judge_handoff",
    durationMs,
    judgeChatUrl: getSupportedApp(activeSession.judgeApp).newChatUrl,
    judgePrompt: judgePrompt.text,
    errorMessage: judgePrompt.severelyTrimmed ? "Some agent responses were shortened to fit the judge's input." : undefined
  };

  await saveActiveSession();
  await broadcastSnapshot();
}

async function cancelCouncil(): Promise<PanelResponse> {
  if (!activeSession || activeSession.status !== "running") {
    return { ok: true, snapshot: getSnapshot() };
  }

  clearTimers();

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
    )
  };

  await saveActiveSession();
  activeSession = null;
  await broadcastSnapshot();

  return { ok: true, snapshot: getSnapshot(), history: await listSessions() };
}

async function switchToJudge(): Promise<PanelResponse> {
  if (!activeSession || !activeSession.judgeChatUrl) {
    return { ok: false, error: "Judge tab is unavailable", snapshot: getSnapshot() };
  }

  await browser.tabs.create({ url: activeSession.judgeChatUrl, active: true });
  return { ok: true, snapshot: getSnapshot() };
}

async function saveActiveSession(): Promise<void> {
  if (!activeSession) {
    return;
  }

  const storedSession: StoredCouncilSession = {
    timestamp: activeSession.timestamp,
    prompt: activeSession.prompt,
    agentsUsed: activeSession.agentsUsed,
    judgeApp: activeSession.judgeApp,
    judgeChatUrl: activeSession.judgeChatUrl,
    agentResults: activeSession.agentResults,
    status: activeSession.status,
    durationMs: activeSession.durationMs,
    judgePrompt: activeSession.judgePrompt,
    errorMessage: activeSession.errorMessage,
    demo: true
  };

  await saveSession(storedSession);
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

function clearTimers(): void {
  activeTimers.forEach((timer) => clearTimeout(timer));
  activeTimers = [];
}

function isActiveSession(sessionId: string): boolean {
  return activeSession?.id === sessionId && activeSession.status === "running";
}
