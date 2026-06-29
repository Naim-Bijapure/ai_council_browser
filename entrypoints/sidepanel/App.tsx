import { useEffect, useMemo, useState } from "react";
import { browser } from "wxt/browser";
import { SUPPORTED_APPS } from "../../utils/appRegistry";
import {
  formatAgentStatus,
  formatAppName,
  formatCharacterCount,
  formatSessionStatus,
  formatTimestamp,
  truncateText
} from "../../utils/format";
import {
  MAX_USER_PROMPT_LENGTH,
  type AppKey,
  type BackgroundEvent,
  type CouncilPreferences,
  type CouncilSnapshot,
  type PanelRequest,
  type PanelResponse,
  type StoredCouncilSession
} from "../../utils/types";

type ActiveTab = "council" | "history";

const idleSnapshot: CouncilSnapshot = { state: "idle", session: null };

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("council");
  const [prompt, setPrompt] = useState("");
  const [selectedAgentKeys, setSelectedAgentKeys] = useState<AppKey[]>([]);
  const [judgeKey, setJudgeKey] = useState<AppKey>("chatgpt");
  const [snapshot, setSnapshot] = useState<CouncilSnapshot>(idleSnapshot);
  const [history, setHistory] = useState<StoredCouncilSession[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const activeSession = snapshot.state === "active" ? snapshot.session : null;
  const isRunning = activeSession?.status === "running";
  const isHandoff = activeSession?.status === "judge_handoff";
  const promptTooLong = prompt.length > MAX_USER_PROMPT_LENGTH;
  const canRun = prompt.trim().length > 0 && selectedAgentKeys.length > 0 && Boolean(judgeKey) && !promptTooLong && !isRunning;
  const completedCount = useMemo(() => {
    if (!activeSession) {
      return 0;
    }

    return activeSession.agentResults.filter((result) => ["done", "timeout", "error"].includes(result.status)).length;
  }, [activeSession]);

  useEffect(() => {
    void loadBootstrap();

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
    if (!loading) {
      void savePreferences({ selectedAgentKeys, judgeKey });
    }
  }, [selectedAgentKeys, judgeKey, loading]);

  useEffect(() => {
    if (activeTab === "history") {
      void refreshHistory();
    }
  }, [activeTab]);

  async function sendMessage(request: PanelRequest): Promise<PanelResponse> {
    return browser.runtime.sendMessage(request);
  }

  async function loadBootstrap(): Promise<void> {
    setLoading(true);
    const response = await sendMessage({ type: "GET_BOOTSTRAP" });

    if (response.ok) {
      if (response.preferences) {
        setSelectedAgentKeys(response.preferences.selectedAgentKeys);
        setJudgeKey(response.preferences.judgeKey);
      }

      setSnapshot(response.snapshot ?? idleSnapshot);
      setHistory(response.history ?? []);
    } else {
      setError(response.error);
    }

    setLoading(false);
  }

  async function savePreferences(preferences: CouncilPreferences): Promise<void> {
    await sendMessage({ type: "SAVE_PREFERENCES", preferences });
  }

  async function refreshHistory(): Promise<void> {
    const response = await sendMessage({ type: "GET_HISTORY" });

    if (response.ok) {
      setHistory(response.history ?? []);
    }
  }

  async function runCouncil(): Promise<void> {
    setError("");
    const response = await sendMessage({
      type: "RUN_COUNCIL",
      request: {
        prompt,
        agentKeys: selectedAgentKeys,
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

    if (!confirmed) {
      return;
    }

    const response = await sendMessage({ type: "CLEAR_HISTORY" });

    if (response.ok) {
      setHistory([]);
    }
  }

  function toggleAgent(agentKey: AppKey): void {
    setSelectedAgentKeys((current) =>
      current.includes(agentKey) ? current.filter((key) => key !== agentKey) : [...current, agentKey]
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>AI Council</h1>
          <p>Demo foundation</p>
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
              completedCount={completedCount}
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
              <label className="field-label" htmlFor="prompt">
                Prompt
              </label>
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

              <fieldset className="option-group">
                <legend>Agents</legend>
                <div className="agent-grid">
                  {SUPPORTED_APPS.map((app) => (
                    <label className="check-row" key={app.key}>
                      <input
                        checked={selectedAgentKeys.includes(app.key)}
                        onChange={() => toggleAgent(app.key)}
                        type="checkbox"
                      />
                      <span>{app.displayName}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="field-label" htmlFor="judge">
                Judge
              </label>
              <select id="judge" value={judgeKey} onChange={(event) => setJudgeKey(event.target.value as AppKey)}>
                {SUPPORTED_APPS.map((app) => (
                  <option key={app.key} value={app.key}>
                    {app.displayName}
                  </option>
                ))}
              </select>

              {error ? <div className="inline-error">{error}</div> : null}
              {promptTooLong ? <div className="inline-error">Prompt is too long.</div> : null}

              <button className="primary-action" disabled={!canRun || loading} type="submit">
                Run council
              </button>
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
  completedCount: number;
  onCancel: () => Promise<void>;
  onNewQuestion: () => Promise<void>;
  onSwitchToJudge: () => Promise<void>;
  session: NonNullable<CouncilSnapshot["session"]>;
}

function SessionView({ completedCount, onCancel, onNewQuestion, onSwitchToJudge, session }: SessionViewProps) {
  const total = session.agentResults.length;
  const isRunning = session.status === "running";
  const isHandoff = session.status === "judge_handoff";

  return (
    <div className="session-view">
      <div className="prompt-summary">
        <span>Question</span>
        <p>{truncateText(session.prompt, 180)}</p>
      </div>

      <div className="progress-block">
        <div className="progress-meta">
          <span>{isRunning ? "Running" : formatSessionStatus(session.status)}</span>
          <span>
            {completedCount} / {total}
          </span>
        </div>
        <progress max={total} value={completedCount} />
      </div>

      <div className="agent-list">
        {session.agentResults.map((result) => (
          <article className={`agent-card ${result.status}`} key={result.agentKey}>
            <div className="agent-card-header">
              <strong>{formatAppName(result.agentKey)}</strong>
              <span>{formatAgentStatus(result.status, result.errorReason)}</span>
            </div>
            {result.status === "done" && result.responseText ? <p>{truncateText(result.responseText, 150)}</p> : null}
            {result.status === "error" && result.errorReason ? <p>{formatAgentStatus(result.status, result.errorReason)}</p> : null}
          </article>
        ))}
      </div>

      {isHandoff ? (
        <div className="handoff">
          <span>Judge is running in {formatAppName(session.judgeApp)}</span>
          {session.errorMessage ? <p>{session.errorMessage}</p> : null}
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
          <span>All agents failed - no judge prompt sent.</span>
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
    if (!session.judgeChatUrl) {
      return;
    }

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
                {formatTimestamp(session.timestamp)} · {session.agentsUsed.length} agents · {formatAppName(session.judgeApp)}
              </small>
              {!session.judgeChatUrl ? <em>Judge URL unavailable</em> : null}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
