import type { AppKey } from "../types";

export type ExecutionMode = "agent" | "judge";

export interface SelectorGroup {
  input: string[];
  send: string[];
  response: string[];
  completion: string[];
  blocked?: string[];
  loginError?: string[];
  /** Thinking/searching/tool-use indicators visible during generation */
  generating?: string[];
  /** Nodes stripped from extracted response text (e.g. thinking blocks) */
  responseExclude?: string[];
  /** Response containers used only for completion detection (defaults to response) */
  responseMonitor?: string[];
}

export interface SelectorConfig {
  appKey: AppKey;
  selectors: SelectorGroup;
}

export interface AdapterResult {
  success: boolean;
  responseText?: string;
  errorReason?: string;
  completedAt?: number;
}

export interface SendConfirmationResult {
  sent: boolean;
  errorReason?: string;
  chatUrl?: string;
}

export interface ReadinessResult {
  ready: boolean;
  errorReason?: string;
}

export interface AutomationTimeouts {
  tabLoadMs: number;
  contentReadyMs: number;
  loginGraceMs: number;
  loginPollIntervalMs: number;
  sendButtonEnableMs: number;
  sendButtonPollIntervalMs: number;
  /** Timeout after sustained idle with no generation signals */
  responseIdleMs: number;
  /** Absolute safety ceiling regardless of activity */
  maxResponseWaitMs: number;
  /** @deprecated Use maxResponseWaitMs */
  responseWaitMs: number;
  urlCaptureMs: number;
}

export const DEFAULT_AUTOMATION_TIMEOUTS: AutomationTimeouts = {
  tabLoadMs: 30_000,
  contentReadyMs: 20_000,
  loginGraceMs: 10_000,
  loginPollIntervalMs: 500,
  sendButtonEnableMs: 10_000,
  sendButtonPollIntervalMs: 100,
  responseIdleMs: 120_000,
  maxResponseWaitMs: 1_800_000,
  responseWaitMs: 1_800_000,
  urlCaptureMs: 30_000
};

export type AdapterErrorReason =
  | "not_logged_in"
  | "tab_load_timeout"
  | "content_script_timeout"
  | "dom_error"
  | "send_button_disabled"
  | "user_interference"
  | "rate_limited"
  | "captcha"
  | "config_error"
  | "send_failed"
  | "cancelled";

export const LOGIN_URL_PATTERNS: Record<AppKey, string[]> = {
  chatgpt: ["/auth/login", "/auth/signup"],
  claude: ["/login"],
  gemini: ["accounts.google.com"],
  deepseek: ["/sign_in", "/sign_up"],
  qwen: ["/login"],
  kimi: ["/login"],
  perplexity: ["/login", "/signin"],
  grok: ["/login", "x.com/login", "accounts.x.com"]
};

export type ProbeMode = "static" | "live";

export type ProbeStepStatus = "pass" | "fail" | "warn" | "skip";

export type ProbeField =
  | "input"
  | "send"
  | "response"
  | "completion"
  | "generating"
  | "blocked"
  | "loginError"
  | "injection"
  | "send_click"
  | "response_wait"
  | "response_preview";

export interface ProbeStep {
  field: ProbeField;
  status: ProbeStepStatus;
  detail: string;
  matchedSelector?: string;
}

export interface ProbeResult {
  appKey: AppKey;
  mode: ProbeMode;
  steps: ProbeStep[];
  durationMs: number;
}
