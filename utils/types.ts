export const MAX_USER_PROMPT_LENGTH = 10_000;

export type AppKey = "chatgpt" | "claude" | "gemini" | "deepseek" | "qwen" | "kimi";

export type AgentStatus = "pending" | "injecting" | "waiting" | "done" | "timeout" | "error";

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
  | "cancelled";

export interface SupportedApp {
  key: AppKey;
  displayName: string;
  domain: string;
  matchPatterns: string[];
  newChatUrl: string;
}

export interface CouncilPreferences {
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
}

export interface ActiveCouncilSession {
  id: string;
  timestamp: number;
  prompt: string;
  agentsUsed: AppKey[];
  judgeApp: AppKey;
  judgeChatUrl: string | null;
  agentResults: AgentResult[];
  status: SessionStatus;
  durationMs: number;
  judgePrompt?: string;
  errorMessage?: string;
}

export interface StoredCouncilSession extends Omit<ActiveCouncilSession, "id"> {
  id?: number;
  demo: boolean;
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
}

export type PanelRequest =
  | { type: "GET_BOOTSTRAP" }
  | { type: "SAVE_PREFERENCES"; preferences: CouncilPreferences }
  | { type: "RUN_COUNCIL"; request: RunCouncilRequest }
  | { type: "CANCEL_COUNCIL" }
  | { type: "NEW_QUESTION" }
  | { type: "SWITCH_TO_JUDGE" }
  | { type: "GET_HISTORY" }
  | { type: "CLEAR_HISTORY" };

export type BackgroundEvent = {
  type: "SESSION_UPDATED";
  snapshot: CouncilSnapshot;
};

export type PanelResponse =
  | {
      ok: true;
      preferences?: CouncilPreferences;
      snapshot?: CouncilSnapshot;
      history?: StoredCouncilSession[];
    }
  | {
      ok: false;
      error: string;
      snapshot?: CouncilSnapshot;
    };
