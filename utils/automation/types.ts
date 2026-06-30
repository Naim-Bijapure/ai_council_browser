import type { AppKey } from "../types";

export type ExecutionMode = "agent" | "judge";

export interface SelectorGroup {
  input: string[];
  send: string[];
  response: string[];
  completion: string[];
  blocked?: string[];
  loginError?: string[];
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
  responseWaitMs: number;
  urlCaptureMs: number;
}

export const DEFAULT_AUTOMATION_TIMEOUTS: AutomationTimeouts = {
  tabLoadMs: 15_000,
  contentReadyMs: 10_000,
  loginGraceMs: 10_000,
  loginPollIntervalMs: 500,
  sendButtonEnableMs: 5_000,
  sendButtonPollIntervalMs: 100,
  responseWaitMs: 45_000,
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
  kimi: ["/login"]
};

export type ProbeMode = "static" | "live";

export type ProbeStepStatus = "pass" | "fail" | "warn" | "skip";

export type ProbeField =
  | "input"
  | "send"
  | "response"
  | "completion"
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
