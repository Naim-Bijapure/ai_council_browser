import type { ProbeResult as AutomationProbeResult } from "./automation/types";

export const MAX_USER_PROMPT_LENGTH = 10_000;

export type AppKey = "chatgpt" | "claude" | "gemini" | "deepseek" | "qwen" | "kimi" | "perplexity" | "grok";

export type AgentStatus = "pending" | "injecting" | "waiting" | "done" | "timeout" | "error" | "skipped";

export type SessionStatus =
  | "idle"
  | "running"
  | "judge_handoff"
  | "done"
  | "partial"
  | "partial_failure"
  | "cancelled"
  | "error";

export type AgentErrorReason =
  | "not_logged_in"
  | "tab_load_timeout"
  | "content_script_timeout"
  | "dom_error"
  | "send_button_disabled"
  | "user_interference"
  | "rate_limited"
  | "captcha"
  | "demo_error"
  | "config_error"
  | "send_failed"
  | "cancelled"
  | "skipped";

export type JudgeStepStatus =
  | "pending"
  | "injecting"
  | "sent"
  | "error"
  | "timeout";

export type JudgeStepDetail = "preparing_prompt" | "opening_tab" | "sending";

export interface JudgeStep {
  status: JudgeStepStatus;
  errorReason?: string;
  detail?: JudgeStepDetail;
  startedAt: number | null;
  completedAt: number | null;
}

export interface SupportedApp {
  key: AppKey;
  displayName: string;
  domain: string;
  matchPatterns: string[];
  newChatUrl: string;
}

// "agentJudge" — parallel agents then judge. "relay" — sequential critique chain then judge.
export type CouncilType = "agentJudge" | "relay";

export type RelayRole = "author" | "reviewer";

export interface CouncilPreferences {
  councilType: CouncilType;
  selectedAgentKeys: AppKey[];
  judgeKey: AppKey;
}

export interface AgentResult {
  agentKey: AppKey;
  status: AgentStatus;
  responseText: string;
  errorReason?: AgentErrorReason | string;
  startedAt: number;
  completedAt: number | null;
  chatUrl?: string;
  relayRole?: RelayRole;
  inputDraft?: string;
  critiqueText?: string;
  revisedAnswerText?: string;
}

export interface ActiveCouncilSession {
  id: string;
  timestamp: number;
  prompt: string;
  councilType: CouncilType;
  agentsUsed: AppKey[];
  judgeApp: AppKey;
  judgeChatUrl: string | null;
  agentResults: AgentResult[];
  judgeStep: JudgeStep;
  agentTabUrl: string | null;
  status: SessionStatus;
  durationMs: number;
  judgePrompt?: string;
  relayFinalDraft?: string;
  errorMessage?: string;
}

export interface StoredCouncilSession extends Omit<ActiveCouncilSession, "id"> {
  id?: number;
  demo?: boolean;
}

export type CouncilSnapshot =
  | {
      state: "idle";
      session: null;
    }
  | {
      state: "active";
      session: ActiveCouncilSession;
    };

export interface RunCouncilRequest {
  prompt: string;
  agentKeys: AppKey[];
  judgeKey: AppKey;
  councilType?: CouncilType;
  windowId?: number;
}

export function toStoredSession(session: ActiveCouncilSession): StoredCouncilSession {
  return {
    timestamp: session.timestamp,
    prompt: session.prompt,
    councilType: session.councilType,
    agentsUsed: session.agentsUsed,
    judgeApp: session.judgeApp,
    judgeChatUrl: session.judgeChatUrl,
    agentResults: session.agentResults,
    judgeStep: session.judgeStep,
    agentTabUrl: session.agentTabUrl,
    status: session.status,
    durationMs: session.durationMs,
    judgePrompt: session.judgePrompt,
    relayFinalDraft: session.relayFinalDraft,
    errorMessage: session.errorMessage
  };
}

export type PanelRequest =
  | { type: "GET_BOOTSTRAP" }
  | { type: "SAVE_PREFERENCES"; preferences: CouncilPreferences }
  | { type: "RUN_COUNCIL"; request: RunCouncilRequest }
  | { type: "CANCEL_COUNCIL" }
  | { type: "SKIP_AGENT"; agentKey: AppKey }
  | { type: "NEW_QUESTION" }
  | { type: "SWITCH_TO_JUDGE" }
  | { type: "GET_HISTORY" }
  | { type: "CLEAR_HISTORY" }
  | { type: "RUN_DIAGNOSTIC"; agentKeys: AppKey[] }
  | { type: "RUN_PROBE"; appKey: AppKey; mode: "static" | "live" };

export type BackgroundEvent = {
  type: "SESSION_UPDATED";
  snapshot: CouncilSnapshot;
};

export type DiagnosticReport = Partial<Record<AppKey, {
  ready: boolean;
  errorReason?: string;
  tabUrl: string | null;
}>>;

export type PanelResponse =
  | {
      ok: true;
      preferences?: CouncilPreferences;
      snapshot?: CouncilSnapshot;
      history?: StoredCouncilSession[];
      diagnostic?: DiagnosticReport;
      probe?: AutomationProbeResult;
    }
  | {
      ok: false;
      error: string;
      errorDetail?: string;
      snapshot?: CouncilSnapshot;
    };
