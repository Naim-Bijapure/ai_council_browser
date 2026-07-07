import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import {
  formatAgentStatus,
  formatAppName,
  formatCharacterCount,
  formatErrorReason,
  formatSessionStatus,
  formatTimestamp,
  truncateText
} from "../../utils/format";
import { isActiveCouncilRun } from "../../utils/sessionState";
import {
  DEFAULT_AGENT_KEYS,
  DEFAULT_JUDGE_KEY,
  getAppsForRole,
  SUPPORTED_APPS
} from "../../utils/appRegistry";
import {
  MAX_USER_PROMPT_LENGTH,
  type AgentResult,
  type AppKey,
  type BackgroundEvent,
  type CouncilPreferences,
  type CouncilSnapshot,
  type CouncilType,
  type DiagnosticReport,
  type JudgeStepDetail,
  type JudgeStepStatus,
  type PanelRequest,
  type PanelResponse,
  type StoredCouncilSession
} from "../../utils/types";
import type { ProbeResult, ProbeStep } from "../../utils/automation/types";
import { AgentOrderList } from "./components/AgentOrderList";
import { reorderAgents } from "../../utils/agentOrdering";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { PromptEditor } from "./components/PromptEditor";
import {
  DEFAULT_JUDGE_PROMPT_TEMPLATE_ID,
  JUDGE_PROMPT_TEMPLATES
} from "../../utils/judgePromptTemplates";
import {
  DEFAULT_RELAY_JUDGE_PROMPT_TEMPLATE_ID,
  RELAY_JUDGE_PROMPT_TEMPLATES
} from "../../utils/relayJudgePromptTemplates";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

type ActiveTab = "council" | "history";

// Whether the developer tools (Run Diagnostics + Selector Probe) are shown in
// the side panel. Controlled by the WXT_SHOW_DEV_TOOLS env flag (see .env); when
// the flag is unset it defaults to dev-only (visible under `wxt dev`, hidden in
// production builds).
const SHOW_DEV_TOOLS =
  (import.meta.env.WXT_SHOW_DEV_TOOLS ?? String(import.meta.env.DEV)) === "true";

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

const JUDGE_DETAIL_LABELS: Record<JudgeStepDetail, string> = {
  preparing_prompt: "Preparing judge prompt…",
  opening_tab: "Opening judge tab…",
  sending: "Sending judge prompt…"
};

function formatJudgeStepLabel(status: JudgeStepStatus, detail?: JudgeStepDetail): string {
  if (status === "injecting" && detail) {
    return JUDGE_DETAIL_LABELS[detail];
  }
  return JUDGE_STEP_LABELS[status];
}

const COUNCIL_TYPE_LABELS: Record<CouncilType, string> = {
  agentJudge: "Agent → Judge Council",
  relay: "Relay Council"
};

const APP_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  kimi: "Kimi",
  perplexity: "Perplexity",
  grok: "Grok"
};

// Status → badge variant mapping used across agent/judge/diagnostic cards.
const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  injecting: "secondary",
  waiting: "secondary",
  sent: "default",
  done: "default",
  timeout: "destructive",
  error: "destructive",
  skipped: "outline"
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("council");
  const [councilType, setCouncilType] = useState<CouncilType>("agentJudge");
  const [prompt, setPrompt] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<AppKey[]>(DEFAULT_AGENT_KEYS);
  const [judgeKey, setJudgeKey] = useState<AppKey>(DEFAULT_JUDGE_KEY);
  const [agentJudgeTemplateId, setAgentJudgeTemplateId] = useState(DEFAULT_JUDGE_PROMPT_TEMPLATE_ID);
  const [relayTemplateId, setRelayTemplateId] = useState(DEFAULT_RELAY_JUDGE_PROMPT_TEMPLATE_ID);

  const currentTemplateId = councilType === "relay" ? relayTemplateId : agentJudgeTemplateId;
  const currentTemplates = councilType === "relay" ? RELAY_JUDGE_PROMPT_TEMPLATES : JUDGE_PROMPT_TEMPLATES;
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
  const [expandedAgent, setExpandedAgent] = useState<AppKey | null>(null);

  const activeSession = snapshot.state === "active" ? snapshot.session : null;
  const isRunning = activeSession ? isActiveCouncilRun(activeSession) : false;
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
  }, [councilType, selectedAgents, judgeKey, agentJudgeTemplateId, relayTemplateId]);

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
        if (response.preferences.councilType) {
          setCouncilType(response.preferences.councilType);
        }
        if (response.preferences.selectedAgentKeys.length > 0) {
          setSelectedAgents(response.preferences.selectedAgentKeys);
        }
        if (response.preferences.judgeKey) {
          setJudgeKey(response.preferences.judgeKey);
        }
        if (response.preferences.judgePromptTemplateId) {
          setAgentJudgeTemplateId(response.preferences.judgePromptTemplateId);
        }
        if (response.preferences.relayJudgePromptTemplateId) {
          setRelayTemplateId(response.preferences.relayJudgePromptTemplateId);
        }
      }
    } else {
      setError(response.error);
    }

    setLoading(false);
  }

  async function savePreferences(): Promise<void> {
    const preferences: CouncilPreferences = {
      councilType,
      selectedAgentKeys: selectedAgents,
      judgeKey,
      judgePromptTemplateId: agentJudgeTemplateId,
      relayJudgePromptTemplateId: relayTemplateId
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

  function handleReorder(sourceKey: AppKey, targetKey: AppKey): void {
    setSelectedAgents((prev) => {
      const newOrder = reorderAgents(prev, sourceKey, targetKey);
      return newOrder;
    });
  }

  // When judge changes, deselect it from agents if selected
  useEffect(() => {
    setSelectedAgents((prev) => prev.filter((k) => k !== judgeKey));
  }, [judgeKey]);

  async function runCouncil(): Promise<void> {
    setError("");
    // Get the current window ID to ensure the judge opens in the same window
    // as the side panel (not the last focused window which could be a chat tab)
    let windowId: number | undefined;
    try {
      const window = await browser.windows.getCurrent();
      windowId = window.id;
    } catch {
      // ignore
    }
    
    const response = await sendMessage({
      type: "RUN_COUNCIL",
        request: {
          prompt,
          agentKeys: selectedAgents,
          judgeKey,
          councilType,
          windowId,
          judgePromptTemplateId: currentTemplateId
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

  async function handleSkipAgent(agentKey: AppKey): Promise<void> {
    await sendMessage({ type: "SKIP_AGENT", agentKey });
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
        setProbeError(response.errorDetail ?? response.error);
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
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-end justify-between gap-3 border-b border-border bg-card px-4 pb-3 pt-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-foreground">AI Council</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {councilType === "agentJudge"
              ? `${selectedAgents.length} agent${selectedAgents.length !== 1 ? "s" : ""} → ${formatAppName(judgeKey)} judge`
              : `Relay: ${selectedAgents.length} step${selectedAgents.length !== 1 ? "s" : ""} → ${formatAppName(judgeKey)} judge`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeSession && !isRunning ? (
            <Button variant="outline" size="sm" onClick={() => void newQuestion()} type="button">
              New question
            </Button>
          ) : null}
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ActiveTab)}>
            <TabsList aria-label="AI Council sections">
              <TabsTrigger value="council">Council</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      {activeTab === "council" ? (
        <section className="flex-1 p-4">
          {activeSession ? (
            <SessionView
              expandedAgent={expandedAgent}
              isRunning={isRunning}
              onCancel={cancelCouncil}
              onNewQuestion={newQuestion}
              onSkipAgent={handleSkipAgent}
              onSwitchToJudge={switchToJudge}
              onToggleAgent={setExpandedAgent}
              session={activeSession}
            />
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (canRun) {
                  void runCouncil();
                }
              }}
            >
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
                <Label htmlFor="council-type">Choose council</Label>
                <Select value={councilType} onValueChange={(value) => setCouncilType(value as CouncilType)}>
                  <SelectTrigger id="council-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(COUNCIL_TYPE_LABELS) as CouncilType[]).map((type) => (
                      <SelectItem key={type} value={type}>
                        {COUNCIL_TYPE_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
                <Label htmlFor="prompt">Prompt</Label>
                <PromptEditor
                  id="prompt"
                  value={prompt}
                  onChange={setPrompt}
                  placeholder="Ask one question for the council..."
                  rows={8}
                />
                <div className={cn("self-end text-xs text-muted-foreground", promptTooLong && "text-destructive")}>
                  {formatCharacterCount(prompt.length, MAX_USER_PROMPT_LENGTH)}
                </div>
                {promptTooLong ? <InlineError>Prompt is too long.</InlineError> : null}
              </div>

              <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
                <Label>Judge & Prompt Style</Label>
                <div className="flex gap-2">
                  <Select value={judgeKey} onValueChange={(value) => setJudgeKey(value as AppKey)}>
                    <SelectTrigger id="judge" className="flex-1 min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {judgeApps.map((app) => (
                        <SelectItem key={app.key} value={app.key}>
                          {app.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={currentTemplateId} onValueChange={(id) => {
                    if (councilType === "relay") {
                      setRelayTemplateId(id);
                    } else {
                      setAgentJudgeTemplateId(id);
                    }
                  }}>
                    <SelectTrigger className="flex-1 min-w-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {currentTemplates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <fieldset className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
                <legend className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {councilType === "relay" ? "Relay order" : "Agents"}
                </legend>
                {councilType === "relay" && selectedAgents.length === 1 ? (
                  <p className="mb-1 text-xs text-muted-foreground">
                    Two or more agents recommended — the first answers, each next step critiques and refines.
                  </p>
                ) : null}
                <AgentOrderList
                  agents={agentApps}
                  selectedKeys={selectedAgents}
                  judgeKey={judgeKey}
                  showRelayRoles={councilType === "relay"}
                  onToggle={toggleAgent}
                  onReorder={handleReorder}
                />
              </fieldset>

              {error ? <InlineError>{error}</InlineError> : null}
              {selectedAgents.length === 0 ? <InlineError>Select at least one agent.</InlineError> : null}

              <Button disabled={!canRun} type="submit">
                {councilType === "relay" ? "Run relay" : "Run council"}
              </Button>

              {SHOW_DEV_TOOLS && councilType === "agentJudge" ? (
              <>
              <div className="mt-2 flex flex-col gap-2">
                <Button
                  variant="secondary"
                  type="button"
                  disabled={diagnosticRunning}
                  onClick={() => void runDiagnostics()}
                >
                  {diagnosticRunning ? "Running diagnostics…" : "Run diagnostics"}
                </Button>
                {diagnostic ? (
                  <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
                    {(Object.keys(diagnostic) as AppKey[]).map((key) => {
                      const appDiagnostic = diagnostic[key];
                      if (!appDiagnostic) return null;
                      return (
                        <div key={key} className="flex justify-between text-sm text-foreground">
                          <span>{APP_LABELS[key] ?? key}</span>
                          <span className={appDiagnostic.ready ? "font-semibold text-success" : "font-semibold text-destructive"}>
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

              <div className="mt-2 flex flex-col gap-2">
                <Label htmlFor="probe-app">Selector Probe</Label>
                <Select value={probeApp} onValueChange={(value) => setProbeApp(value as AppKey)} disabled={probeRunning}>
                  <SelectTrigger id="probe-app">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_APPS.map((app) => (
                      <SelectItem key={app.key} value={app.key}>
                        {app.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    type="button"
                    disabled={probeRunning}
                    onClick={() => void runProbe("static")}
                    className="flex-1"
                  >
                    Static Probe
                  </Button>
                  <Button
                    variant="secondary"
                    type="button"
                    disabled={probeRunning}
                    onClick={() => void runProbe("live")}
                    className="flex-1"
                  >
                    Live Probe
                  </Button>
                </div>
                {probeRunning ? <div className="text-sm italic text-muted-foreground">Probing…</div> : null}
                {probeError ? <InlineError>{probeError}</InlineError> : null}
                {probeResult ? (
                  <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-3">
                    <div className="mb-1 text-xs text-muted-foreground">
                      {APP_LABELS[probeResult.appKey] ?? probeResult.appKey} · {probeResult.mode} · {probeResult.durationMs}ms
                    </div>
                    {probeResult.steps.map((s, i) => (
                      <ProbeStepRow key={i} step={s} />
                    ))}
                  </div>
                ) : null}
              </div>
              </>
              ) : null}
            </form>
          )}
        </section>
      ) : (
        <HistoryView history={history} onClearHistory={clearHistory} />
      )}
    </main>
  );
}

function InlineError({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      {children}
    </div>
  );
}

interface SessionViewProps {
  expandedAgent: AppKey | null;
  isRunning: boolean;
  onCancel: () => Promise<void>;
  onNewQuestion: () => Promise<void>;
  onSkipAgent: (agentKey: AppKey) => Promise<void>;
  onSwitchToJudge: () => Promise<void>;
  onToggleAgent: (key: AppKey | null) => void;
  session: NonNullable<CouncilSnapshot["session"]>;
}

function relayStepLabel(role: AgentResult["relayRole"]): string {
  return role === "author" ? "Author" : role === "reviewer" ? "Reviewer" : "Agent";
}

function SessionView({
  expandedAgent,
  isRunning,
  onCancel,
  onNewQuestion,
  onSkipAgent,
  onSwitchToJudge,
  onToggleAgent,
  session
}: SessionViewProps) {
  const isRelay = session.councilType === "relay";
  const judgeStep = session.judgeStep ?? { status: "pending" as JudgeStepStatus, startedAt: null, completedAt: null };
  const isHandoff = session.status === "done" || session.status === "partial" || judgeStep.status === "sent";
  const completedAgents = session.agentResults.filter((r) => r.status === "done" || r.status === "error" || r.status === "timeout" || r.status === "skipped").length;
  const totalAgents = session.agentResults.length;
  const activeAgent = session.agentResults.find((r) => r.status === "injecting" || r.status === "waiting");
  const showFinalDraft = isRelay && session.relayFinalDraft && !isRunning && judgeStep.status !== "sent";

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">Question</span>
          {isRelay ? <Badge variant="outline">Relay</Badge> : <Badge variant="outline">Council</Badge>}
        </div>
        <p className="mt-1 text-foreground">{truncateText(session.prompt, 180)}</p>
      </div>

      {session.status === "running" || session.status === "judge_handoff" ? (
        <div className="grid gap-2">
          <Progress value={session.status === "judge_handoff" ? 100 : totalAgents > 0 ? (completedAgents / totalAgents) * 100 : 0} />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {session.status === "judge_handoff"
                ? `Relay complete — handing off to ${formatAppName(session.judgeApp)} judge`
                : isRelay
                  ? `Step ${Math.min(completedAgents + 1, totalAgents)} of ${totalAgents}`
                  : `${completedAgents} / ${totalAgents} agents complete`}
            </span>
            {isRelay && activeAgent && session.status === "running" ? (
              <span>{relayStepLabel(activeAgent.relayRole)}: {formatAppName(activeAgent.agentKey)}</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {showFinalDraft ? (
        <div className="rounded-lg border border-primary/40 bg-primary/10 p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Final refined draft</span>
          <p className="mt-2 text-sm text-foreground">{truncateText(session.relayFinalDraft ?? "", 240)}</p>
        </div>
      ) : null}

      <div className="grid gap-2">
        {session.agentResults.map((result) => {
          const hasResult = result.status === "done" && result.responseText;
          const isExpanded = expandedAgent === result.agentKey;
          return (
            <article
              key={result.agentKey}
              className={cn(
                "rounded-md border border-border border-l-[3px] bg-card p-3 transition-colors",
                AGENT_STATUS_BORDER[result.status] ?? "border-l-muted-foreground",
                hasResult && "cursor-pointer hover:bg-secondary"
              )}
              onClick={hasResult ? () => onToggleAgent(isExpanded ? null : result.agentKey) : undefined}
              role={hasResult ? "button" : undefined}
              tabIndex={hasResult ? 0 : undefined}
              onKeyDown={hasResult ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggleAgent(isExpanded ? null : result.agentKey);
                }
              } : undefined}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <strong className="text-sm text-foreground">{formatAppName(result.agentKey)}</strong>
                  {isRelay && result.relayRole ? (
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                      {relayStepLabel(result.relayRole)}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">(Agent)</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {isRunning && (result.status === "injecting" || result.status === "waiting") ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onSkipAgent(result.agentKey);
                      }}
                      type="button"
                    >
                      Skip
                    </Button>
                  ) : null}
                  <Badge
                    variant={STATUS_BADGE_VARIANT[result.status] ?? "outline"}
                    className={result.status === "skipped" ? "border-warning text-warning" : undefined}
                  >
                    {formatAgentStatus(result.status, result.errorReason)}
                  </Badge>
                </div>
              </div>
              {hasResult ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {truncateText(
                    isRelay && result.revisedAnswerText
                      ? result.revisedAnswerText
                      : result.responseText,
                    150
                  )}
                </p>
              ) : null}
              {hasResult && isRelay && result.critiqueText ? (
                <p className="mt-1 text-[11px] italic text-muted-foreground">
                  Critique: {truncateText(result.critiqueText, 80)}
                </p>
              ) : null}
              {result.status === "error" && result.errorReason ? (
                <p className="mt-2 text-xs text-muted-foreground">{formatAgentStatus(result.status, result.errorReason)}</p>
              ) : null}
              {result.status === "skipped" ? (
                <p className="mt-2 text-xs text-warning">Agent skipped by user</p>
              ) : null}
              {result.chatUrl ? (
                <a
                  href={result.chatUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block text-[11px] underline text-muted-foreground hover:text-primary"
                  onClick={(e) => e.stopPropagation()}
                >
                  View conversation
                </a>
              ) : null}
              {hasResult ? <span className="mt-2 block text-[11px] italic text-primary">Click to view full response</span> : null}
            </article>
          );
        })}

        <article className={cn("rounded-md border border-border border-l-[3px] bg-card p-3", AGENT_STATUS_BORDER[judgeStep.status] ?? "border-l-muted-foreground")}>
          <div className="flex items-center justify-between gap-2">
            <strong className="text-sm text-foreground">{formatAppName(session.judgeApp)} (Judge)</strong>
            <Badge variant={STATUS_BADGE_VARIANT[judgeStep.status] ?? "outline"}>
              {formatJudgeStepLabel(judgeStep.status, judgeStep.detail)}
              {judgeStep.errorReason ? `: ${formatErrorReason(judgeStep.errorReason)}` : ""}
            </Badge>
          </div>
        </article>
      </div>

      {expandedAgent ? (
        <AgentResultPopup
          agentKey={expandedAgent}
          result={session.agentResults.find((r) => r.agentKey === expandedAgent)}
          onClose={() => onToggleAgent(null)}
        />
      ) : null}

      {isHandoff && judgeStep.status === "sent" ? (
        <div className="grid gap-3 rounded-lg border border-primary/40 bg-primary/10 p-4">
          <span className="font-bold text-foreground">Judge is running in {formatAppName(session.judgeApp)}</span>
          {session.errorMessage ? <p className="text-xs text-muted-foreground">{session.errorMessage}</p> : null}
          {session.judgeChatUrl ? (
            <p className="text-xs text-muted-foreground">Judge URL captured — switch to the tab to read the verdict.</p>
          ) : (
            <p className="text-xs text-muted-foreground">Judge URL unavailable — check the {formatAppName(session.judgeApp)} tab manually.</p>
          )}
          <div className="flex items-stretch gap-2">
            <Button variant="secondary" onClick={() => void onSwitchToJudge()} type="button" className="flex-1">
              Switch to judge tab
            </Button>
            <Button onClick={() => void onNewQuestion()} type="button" className="flex-1">
              New question
            </Button>
          </div>
        </div>
      ) : null}

      {judgeStep.status === "error" || judgeStep.status === "timeout" ? (
        <div className="grid gap-3 rounded-lg border border-destructive/35 bg-destructive/10 p-4">
          <span className="font-bold text-foreground">
            Judge step failed
            {judgeStep.errorReason ? `: ${formatErrorReason(judgeStep.errorReason)}` : ""}
          </span>
          <p className="text-xs text-muted-foreground">
            Agent results were saved. Start a new question to run the council again.
          </p>
          <Button onClick={() => void onNewQuestion()} type="button">
            New question
          </Button>
        </div>
      ) : null}

      {session.status === "partial_failure" && judgeStep.status !== "error" && judgeStep.status !== "timeout" ? (
        <div className="grid gap-3 rounded-lg border border-destructive/35 bg-destructive/10 p-4">
          <span className="font-bold text-foreground">
            {session.errorMessage ?? "Judge step failed — no judge prompt was sent (agents may have succeeded)."}
          </span>
          <Button onClick={() => void onNewQuestion()} type="button">
            New question
          </Button>
        </div>
      ) : null}

      {session.status === "error" ? (
        <div className="grid gap-3 rounded-lg border border-destructive/35 bg-destructive/10 p-4">
          <span className="font-bold text-foreground">Session error: {session.errorMessage ?? "Council run failed"}</span>
          <Button onClick={() => void onNewQuestion()} type="button">
            New question
          </Button>
        </div>
      ) : null}

      {isRunning ? (
        <Button variant="destructive" onClick={() => void onCancel()} type="button" className="mt-2">
          Cancel
        </Button>
      ) : (
        <Button onClick={() => void onNewQuestion()} type="button" className="mt-2">
          New question
        </Button>
      )}
    </div>
  );
}

// Maps agent/judge status strings to a left-border accent color utility.
const AGENT_STATUS_BORDER: Record<string, string> = {
  pending: "border-l-muted-foreground",
  injecting: "border-l-primary",
  waiting: "border-l-primary",
  done: "border-l-success",
  sent: "border-l-success",
  timeout: "border-l-destructive",
  error: "border-l-destructive",
  skipped: "border-l-warning"
};

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
    <section className="flex flex-1 flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight text-foreground">History</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={history.length === 0}
          onClick={() => void onClearHistory()}
          type="button"
        >
          Clear
        </Button>
      </div>

      {history.length === 0 ? (
        <div className="grid min-h-[120px] place-items-center rounded-lg border border-dashed border-border bg-card text-muted-foreground">
          No council sessions yet.
        </div>
      ) : (
        <div className="grid gap-2">
          {history.map((session) => (
            <button
              className={cn(
                "grid gap-1 rounded-md border border-border bg-card p-3 text-left transition-colors hover:bg-secondary",
                !session.judgeChatUrl && "opacity-60"
              )}
              disabled={!session.judgeChatUrl}
              key={session.id ?? `${session.timestamp}-${session.prompt}`}
              onClick={() => void openSession(session)}
              type="button"
            >
              <span className="font-semibold text-foreground">{truncateText(session.prompt, 80)}</span>
              <small className="text-xs text-muted-foreground">
                {formatTimestamp(session.timestamp)} · {session.councilType === "relay" ? "Relay" : "Council"} · {formatSessionStatus(session.status)} · {session.agentsUsed.length} agent{session.agentsUsed.length !== 1 ? "s" : ""} · Judge: {formatAppName(session.judgeApp)}
              </small>
              {!session.judgeChatUrl ? <em className="text-xs text-muted-foreground">Judge URL unavailable</em> : null}
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

const PROBE_ICON_COLOR: Record<ProbeStep["status"], string> = {
  pass: "text-success",
  fail: "text-destructive",
  warn: "text-warning",
  skip: "text-muted-foreground"
};

function ProbeStepRow({ step }: { step: ProbeStep }) {
  return (
    <div className="grid grid-cols-[20px_90px_1fr] items-baseline gap-1 text-sm">
      <span className={cn("text-center font-bold", PROBE_ICON_COLOR[step.status])}>{PROBE_ICONS[step.status]}</span>
      <span className="font-semibold text-muted-foreground">{step.field}</span>
      <span className="break-words text-foreground">{step.detail}</span>
    </div>
  );
}

interface AgentResultPopupProps {
  agentKey: AppKey;
  result: AgentResult | undefined;
  onClose: () => void;
}

function AgentResultPopup({ agentKey, result, onClose }: AgentResultPopupProps) {
  if (!result) return null;

  const duration = result.completedAt && result.startedAt
    ? ((result.completedAt - result.startedAt) / 1000).toFixed(1) + "s"
    : "—";
  const hasRelaySections = Boolean(result.critiqueText || result.revisedAnswerText);

  async function copyToClipboard(text: string): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore — clipboard may be unavailable
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>
            {formatAppName(agentKey)}
            {result.relayRole ? ` — ${relayStepLabel(result.relayRole)}` : " — Full Response"}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-3 border-b border-border bg-card px-4 py-3 text-xs text-muted-foreground">
          <span>Status: {formatAgentStatus(result.status, result.errorReason)}</span>
          <span>Duration: {duration}</span>
          <span>Length: {result.responseText.length.toLocaleString()} chars</span>
        </div>
        {result.responseText ? (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {hasRelaySections ? (
                <div className="grid gap-4">
                  {result.critiqueText ? (
                    <section>
                      <h3 className="mb-2 text-sm font-semibold text-foreground">Critique</h3>
                      <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{result.critiqueText}</pre>
                    </section>
                  ) : null}
                  {result.revisedAnswerText ? (
                    <section>
                      <h3 className="mb-2 text-sm font-semibold text-foreground">Revised answer</h3>
                      <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{result.revisedAnswerText}</pre>
                    </section>
                  ) : null}
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{result.responseText}</pre>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="secondary"
                onClick={() => void copyToClipboard(result.revisedAnswerText ?? result.responseText)}
                type="button"
              >
                Copy
              </Button>
              <Button onClick={onClose} type="button">
                Close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <p className="text-foreground">No response text available.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
