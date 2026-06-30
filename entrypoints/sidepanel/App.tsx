import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import {
  formatAgentStatus,
  formatAppName,
  formatCharacterCount,
  formatSessionStatus,
  formatTimestamp,
  truncateText
} from "../../utils/format";
import {
  getAppsForRole,
  SUPPORTED_APPS,
  type SupportedAppWithRoles
} from "../../utils/appRegistry";
import {
  MAX_USER_PROMPT_LENGTH,
  type AppKey,
  type BackgroundEvent,
  type CouncilPreferences,
  type CouncilSnapshot,
  type DiagnosticReport,
  type JudgeStepStatus,
  type PanelRequest,
  type PanelResponse,
  type StoredCouncilSession
} from "../../utils/types";
import type { ProbeResult, ProbeStep } from "../../utils/automation/types";

type ActiveTab = "council" | "history";

const idleSnapshot: CouncilSnapshot = { state: "idle", session: null };
const agentApps = getAppsForRole("agent");
const judgeApps = getAppsForRole("judge");

const JUDGE_STEP_LABELS: Record<JudgeStepStatus, string> = {
  pending: "Waiting…",
  injecting: "Injecting judge prompt…",
  sent: "Judge prompt sent",
  error: "Judge failed",
  timeout: "Judge timed out"
};

const APP_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  kimi: "Kimi"
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("council");
  const [prompt, setPrompt] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<AppKey[]>(() =>
    agentApps.map((a) => a.key)
  );
  const [judgeKey, setJudgeKey] = useState<AppKey>(
    judgeApps.length > 0 ? judgeApps[0].key : "chatgpt"
  );
  const [snapshot, setSnapshot] = useState<CouncilSnapshot>(idleSnapshot);
  const [history, setHistory] = useState<StoredCouncilSession[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [diagnostic, setDiagnostic] = useState<DiagnosticReport | null>(null);
  const [diagnosticRunning, setDiagnosticRunning] = useState(false);
  const [probeApp, setProbeApp] = useState<AppKey>("qwen");
  const [probeRunning, setProbeRunning] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [probeError, setProbeError] = useState("");

  const activeSession = snapshot.state === "active" ? snapshot.session : null;
  const isRunning = activeSession?.status === "running";
  const promptTooLong = prompt.length > MAX_USER_PROMPT_LENGTH;
  const canRun = prompt.trim().length > 0 && !promptTooLong && !isRunning && !loading && selectedAgents.length > 0;

  // Load saved preferences on mount
  useEffect(() => {
    void loadBootstrap();
  }, []);

  useEffect(() => {
    const listener = (message: BackgroundEvent) => {
      if (message.type === "SESSION_UPDATED") {
        setSnapshot(message.snapshot);
        if (message.snapshot.state === "active" && message.snapshot.session.status !== "running") {
          void refreshHistory();
        }
      }
    };

    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => {
    if (activeTab === "history") {
      void refreshHistory();
    }
  }, [activeTab]);

  // Save preferences when selections change
  useEffect(() => {
    if (!loading) {
      void savePreferences();
    }
  }, [selectedAgents, judgeKey]);

  async function sendMessage(request: PanelRequest): Promise<PanelResponse> {
    return browser.runtime.sendMessage(request);
  }

  async function loadBootstrap(): Promise<void> {
    setLoading(true);
    const response = await sendMessage({ type: "GET_BOOTSTRAP" });

    if (response.ok) {
      setSnapshot(response.snapshot ?? idleSnapshot);
      setHistory(response.history ?? []);

      if (response.preferences) {
        if (response.preferences.selectedAgentKeys.length > 0) {
          setSelectedAgents(response.preferences.selectedAgentKeys);
        }
        if (response.preferences.judgeKey) {
          setJudgeKey(response.preferences.judgeKey);
        }
      }
    } else {
      setError(response.error);
    }

    setLoading(false);
  }

  async function savePreferences(): Promise<void> {
    const preferences: CouncilPreferences = {
      selectedAgentKeys: selectedAgents,
      judgeKey
    };
    await sendMessage({ type: "SAVE_PREFERENCES", preferences });
  }

  async function refreshHistory(): Promise<void> {
    const response = await sendMessage({ type: "GET_HISTORY" });
    if (response.ok) {
      setHistory(response.history ?? []);
    }
  }

  function toggleAgent(key: AppKey): void {
    if (key === judgeKey) return;
    setSelectedAgents((prev) =>
      prev.includes(key)
        ? prev.filter((k) => k !== key)
        : [...prev, key]
    );
  }

  // When judge changes, deselect it from agents if selected
  useEffect(() => {
    setSelectedAgents((prev) => prev.filter((k) => k !== judgeKey));
  }, [judgeKey]);

  async function runCouncil(): Promise<void> {
    setError("");
    const response = await sendMessage({
      type: "RUN_COUNCIL",
      request: {
        prompt,
        agentKeys: selectedAgents,
        judgeKey
      }
    });

    if (response.ok) {
      setSnapshot(response.snapshot ?? idleSnapshot);
    } else {
      setError(response.error);
    }
  }

  async function cancelCouncil(): Promise<void> {
    const response = await sendMessage({ type: "CANCEL_COUNCIL" });
    if (response.ok) {
      setSnapshot(response.snapshot ?? idleSnapshot);
      setHistory(response.history ?? history);
    } else {
      setError(response.error);
    }
  }

  async function newQuestion(): Promise<void> {
    const response = await sendMessage({ type: "NEW_QUESTION" });
    if (response.ok) {
      setPrompt("");
      setError("");
      setSnapshot(response.snapshot ?? idleSnapshot);
      await refreshHistory();
    }
  }

  async function switchToJudge(): Promise<void> {
    const response = await sendMessage({ type: "SWITCH_TO_JUDGE" });
    if (!response.ok) {
      setError(response.error);
    }
  }

  async function clearHistory(): Promise<void> {
    const confirmed = confirm(`Delete all ${history.length} sessions?`);
    if (!confirmed) return;

    const response = await sendMessage({ type: "CLEAR_HISTORY" });
    if (response.ok) {
      setHistory([]);
    }
  }

  async function runDiagnostics(): Promise<void> {
    setDiagnosticRunning(true);
    setError("");
    try {
      const response = await sendMessage({ type: "RUN_DIAGNOSTIC", agentKeys: selectedAgents });
      if (response.ok && response.diagnostic) {
        setDiagnostic(response.diagnostic);
      } else if (!response.ok) {
        setError(response.error);
      }
    } finally {
      setDiagnosticRunning(false);
    }
  }

  async function runProbe(mode: "static" | "live"): Promise<void> {
    setProbeRunning(true);
    setError("");
    setProbeError("");
    setProbeResult(null);
    try {
      const response = await sendMessage({ type: "RUN_PROBE", appKey: probeApp, mode });
      if (response.ok && response.probe) {
        setProbeResult(response.probe);
      } else if (!response.ok) {
        setProbeError(response.error);
      } else {
        setProbeError("probe result missing from response");
      }
    } catch (err) {
      setProbeError(err instanceof Error ? err.message : "probe request failed");
    } finally {
      setProbeRunning(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>AI Council</h1>
          <p>{selectedAgents.length} agent{selectedAgents.length !== 1 ? "s" : ""} &rarr; {formatAppName(judgeKey)} judge</p>
        </div>
        <div className="tabs" role="tablist" aria-label="AI Council sections">
          <button className={activeTab === "council" ? "active" : ""} onClick={() => setActiveTab("council")}>
            Council
          </button>
          <button className={activeTab === "history" ? "active" : ""} onClick={() => setActiveTab("history")}>
            History
          </button>
        </div>
      </header>

      {activeTab === "council" ? (
        <section className="panel-section">
          {activeSession ? (
            <SessionView
              onCancel={cancelCouncil}
              onNewQuestion={newQuestion}
              onSwitchToJudge={switchToJudge}
              session={activeSession}
            />
          ) : (
            <form
              className="council-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (canRun) {
                  void runCouncil();
                }
              }}
            >
              <fieldset className="option-group">
                <legend>Agents</legend>
                <div className="agent-grid">
                  {agentApps.map((app) => {
                    const isJudge = app.key === judgeKey;
                    return (
                      <label key={app.key} className={`check-row${isJudge ? " disabled" : ""}`}>
                        <input
                          type="checkbox"
                          checked={selectedAgents.includes(app.key)}
                          onChange={() => toggleAgent(app.key)}
                          disabled={isJudge}
                        />
                        <span>{app.displayName}{isJudge ? " (Judge)" : ""}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <label className="field-label" htmlFor="judge">Judge</label>
              <select
                id="judge"
                value={judgeKey}
                onChange={(event) => setJudgeKey(event.target.value as AppKey)}
              >
                {judgeApps.map((app) => (
                  <option key={app.key} value={app.key}>
                    {app.displayName}
                  </option>
                ))}
              </select>

              <label className="field-label" htmlFor="prompt">Prompt</label>
              <textarea
                id="prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask one question for the council..."
                rows={8}
              />
              <div className={promptTooLong ? "counter danger" : "counter"}>
                {formatCharacterCount(prompt.length, MAX_USER_PROMPT_LENGTH)}
              </div>

              {error ? <div className="inline-error">{error}</div> : null}
              {promptTooLong ? <div className="inline-error">Prompt is too long.</div> : null}
              {selectedAgents.length === 0 ? <div className="inline-error">Select at least one agent.</div> : null}

              <button className="primary-action" disabled={!canRun} type="submit">
                Run council
              </button>

              <div className="diagnostic-block">
                <button
                  className="secondary-action"
                  type="button"
                  disabled={diagnosticRunning}
                  onClick={() => void runDiagnostics()}
                >
                  {diagnosticRunning ? "Running diagnostics…" : "Run diagnostics"}
                </button>
                {diagnostic ? (
                  <div className="diagnostic-report">
                    {(Object.keys(diagnostic) as AppKey[]).map((key) => {
                      const appDiagnostic = diagnostic[key];
                      if (!appDiagnostic) return null;
                      return (
                        <div key={key} className="diagnostic-row">
                          <span>{APP_LABELS[key] ?? key}</span>
                          <span className={appDiagnostic.ready ? "status-ok" : "status-error"}>
                            {appDiagnostic.ready
                              ? "Ready"
                              : appDiagnostic.errorReason ?? "not ready"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <div className="probe-block">
                <label className="field-label" htmlFor="probe-app">Selector Probe</label>
                <select
                  id="probe-app"
                  value={probeApp}
                  onChange={(event) => setProbeApp(event.target.value as AppKey)}
                  disabled={probeRunning}
                >
                  {SUPPORTED_APPS.map((app) => (
                    <option key={app.key} value={app.key}>
                      {app.displayName}
                    </option>
                  ))}
                </select>
                <div className="probe-buttons">
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={probeRunning}
                    onClick={() => void runProbe("static")}
                  >
                    Static Probe
                  </button>
                  <button
                    className="secondary-action"
                    type="button"
                    disabled={probeRunning}
                    onClick={() => void runProbe("live")}
                  >
                    Live Probe
                  </button>
                </div>
                {probeRunning ? <div className="probe-status">Probing…</div> : null}
                {probeError ? <div className="inline-error">{probeError}</div> : null}
                {probeResult ? (
                  <div className="probe-results">
                    <div className="probe-meta">
                      {APP_LABELS[probeResult.appKey] ?? probeResult.appKey} · {probeResult.mode} · {probeResult.durationMs}ms
                    </div>
                    {probeResult.steps.map((s, i) => (
                      <ProbeStepRow key={i} step={s} />
                    ))}
                  </div>
                ) : null}
              </div>
            </form>
          )}
        </section>
      ) : (
        <HistoryView history={history} onClearHistory={clearHistory} />
      )}
    </main>
  );
}

interface SessionViewProps {
  onCancel: () => Promise<void>;
  onNewQuestion: () => Promise<void>;
  onSwitchToJudge: () => Promise<void>;
  session: NonNullable<CouncilSnapshot["session"]>;
}

function SessionView({ onCancel, onNewQuestion, onSwitchToJudge, session }: SessionViewProps) {
  const isRunning = session.status === "running";
  const judgeStep = session.judgeStep ?? { status: "pending" as JudgeStepStatus, startedAt: null, completedAt: null };
  const isHandoff = session.status === "done" || session.status === "partial" || judgeStep.status === "sent";
  const completedAgents = session.agentResults.filter((r) => r.status === "done" || r.status === "error" || r.status === "timeout").length;
  const totalAgents = session.agentResults.length;

  return (
    <div className="session-view">
      <div className="prompt-summary">
        <span>Question</span>
        <p>{truncateText(session.prompt, 180)}</p>
      </div>

      {session.status === "running" ? (
        <div className="progress-block">
          <progress value={completedAgents} max={totalAgents} />
          <div className="progress-meta">
            <span>{completedAgents} / {totalAgents} agents complete</span>
          </div>
        </div>
      ) : null}

      <div className="agent-list">
        {session.agentResults.map((result) => (
          <article key={result.agentKey} className={`agent-card ${result.status}`}>
            <div className="agent-card-header">
              <strong>{formatAppName(result.agentKey)} (Agent)</strong>
              <span>{formatAgentStatus(result.status, result.errorReason)}</span>
            </div>
            {result.status === "done" && result.responseText ? (
              <p>{truncateText(result.responseText, 150)}</p>
            ) : null}
            {result.status === "error" && result.errorReason ? (
              <p>{formatAgentStatus(result.status, result.errorReason)}</p>
            ) : null}
          </article>
        ))}

        <article className={`agent-card ${judgeStep.status}`}>
          <div className="agent-card-header">
            <strong>{formatAppName(session.judgeApp)} (Judge)</strong>
            <span>{JUDGE_STEP_LABELS[judgeStep.status]}{judgeStep.errorReason ? `: ${judgeStep.errorReason}` : ""}</span>
          </div>
        </article>
      </div>

      {isHandoff && judgeStep.status === "sent" ? (
        <div className="handoff">
          <span>Judge is running in {formatAppName(session.judgeApp)}</span>
          {session.errorMessage ? <p>{session.errorMessage}</p> : null}
          {session.judgeChatUrl ? (
            <p className="judge-url-note">Judge URL captured — switch to the tab to read the verdict.</p>
          ) : (
            <p className="judge-url-note">Judge URL unavailable — check the {formatAppName(session.judgeApp)} tab manually.</p>
          )}
          <div className="action-row">
            <button className="secondary-action" onClick={() => void onSwitchToJudge()} type="button">
              Switch to judge tab
            </button>
            <button className="primary-action" onClick={() => void onNewQuestion()} type="button">
              New question
            </button>
          </div>
        </div>
      ) : null}

      {session.status === "partial_failure" ? (
        <div className="handoff warning">
          <span>All agents failed — no judge prompt sent.</span>
          <button className="primary-action" onClick={() => void onNewQuestion()} type="button">
            New question
          </button>
        </div>
      ) : null}

      {session.status === "error" ? (
        <div className="handoff warning">
          <span>Session error: {session.errorMessage ?? "judge step failed"}</span>
          <button className="primary-action" onClick={() => void onNewQuestion()} type="button">
            New question
          </button>
        </div>
      ) : null}

      {isRunning ? (
        <button className="danger-action" onClick={() => void onCancel()} type="button">
          Cancel
        </button>
      ) : null}
    </div>
  );
}

interface HistoryViewProps {
  history: StoredCouncilSession[];
  onClearHistory: () => Promise<void>;
}

function HistoryView({ history, onClearHistory }: HistoryViewProps) {
  async function openSession(session: StoredCouncilSession): Promise<void> {
    if (!session.judgeChatUrl) return;
    await browser.tabs.create({ active: true, url: session.judgeChatUrl });
  }

  return (
    <section className="panel-section history-section">
      <div className="section-toolbar">
        <h2>History</h2>
        <button disabled={history.length === 0} onClick={() => void onClearHistory()} type="button">
          Clear
        </button>
      </div>

      {history.length === 0 ? (
        <div className="empty-state">No council sessions yet.</div>
      ) : (
        <div className="history-list">
          {history.map((session) => (
            <button
              className={session.judgeChatUrl ? "history-row" : "history-row dimmed"}
              disabled={!session.judgeChatUrl}
              key={session.id ?? `${session.timestamp}-${session.prompt}`}
              onClick={() => void openSession(session)}
              type="button"
            >
              <span>{truncateText(session.prompt, 80)}</span>
              <small>
                {formatTimestamp(session.timestamp)} · {formatSessionStatus(session.status)} · {session.agentsUsed.length} agent{session.agentsUsed.length !== 1 ? "s" : ""} · Judge: {formatAppName(session.judgeApp)}
              </small>
              {!session.judgeChatUrl ? <em>Judge URL unavailable</em> : null}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

const PROBE_ICONS: Record<ProbeStep["status"], string> = {
  pass: "✓",
  fail: "✗",
  warn: "⚠",
  skip: "→"
};

function ProbeStepRow({ step }: { step: ProbeStep }) {
  return (
    <div className={`probe-row probe-${step.status}`}>
      <span className="probe-icon">{PROBE_ICONS[step.status]}</span>
      <span className="probe-field">{step.field}</span>
      <span className="probe-detail">{step.detail}</span>
    </div>
  );
}
