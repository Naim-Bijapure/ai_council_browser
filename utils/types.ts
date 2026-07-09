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
// "redTeam" — an author drafts an answer, attackers try to break it, defenders harden it, then a judge finalizes.
// "promptRefiner" — a drafter enhances the user's prompt, enhancers progressively refine it, then a judge produces the final enhanced prompt.
// "debate" — debaters state positions then counter each other over N rounds, then a moderator judge delivers the verdict.
export type CouncilType = "agentJudge" | "relay" | "redTeam" | "promptRefiner" | "debate";

export type RelayRole = "author" | "reviewer";

// Red team pipeline roles. Each selected agent holds exactly one role.
export type RedTeamRole = "author" | "attacker" | "defender";

// Debate turn phases. "opening" = state a position; "rebuttal" = counter the others.
export type DebatePhase = "opening" | "rebuttal";

export interface CouncilPreferences {
  councilType: CouncilType;
  selectedAgentKeys: AppKey[];
  judgeKey: AppKey;
  judgePromptTemplateId?: string;
  relayJudgePromptTemplateId?: string;
  // Per-agent role assignment for the red team council (keyed by app).
  redTeamRoles?: Partial<Record<AppKey, RedTeamRole>>;
  redTeamJudgePromptTemplateId?: string;
  promptRefinerJudgePromptTemplateId?: string;
  // Number of rebuttal rounds for the debate council (opening pass runs once).
  debateRounds?: number;
  debateJudgePromptTemplateId?: string;
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
  redTeamRole?: RedTeamRole;
  // Debate turn metadata: which rebuttal round (opening = round 1) and the phase.
  debateRound?: number;
  debatePhase?: DebatePhase;
  inputDraft?: string;
  // Reused across relay + red team + prompt refiner:
  //  - relay reviewer / red team defender: critiqueText = critique/defense, revisedAnswerText = revised/hardened draft
  //  - red team author: revisedAnswerText = the initial draft
  //  - red team attacker: critiqueText = the attack findings
  //  - prompt refiner drafter: revisedAnswerText = the initial enhanced prompt
  //  - prompt refiner enhancer: critiqueText = change notes, revisedAnswerText = the enhanced prompt
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
  judgePromptTemplateId?: string;
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
  judgePromptTemplateId?: string;
  // For the red team council: role per agent, parallel to (and same order as) agentKeys.
  redTeamRoles?: RedTeamRole[];
  // For the debate council: number of rebuttal rounds.
  debateRounds?: number;
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
    judgePromptTemplateId: session.judgePromptTemplateId,
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
