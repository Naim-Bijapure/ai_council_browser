import { getSupportedApp } from "./appRegistry";
import type { AgentErrorReason, AgentStatus, AppKey, SessionStatus } from "./types";

const STATUS_LABELS: Record<AgentStatus, string> = {
  pending: "Pending",
  injecting: "Injecting prompt",
  waiting: "Waiting for response",
  done: "Done",
  timeout: "Timed out",
  error: "Error",
  skipped: "Skipped"
};

const ERROR_LABELS: Record<string, string> = {
  not_logged_in: "Not logged in",
  tab_load_timeout: "Tab failed to load",
  content_script_timeout: "Extension not ready in tab",
  dom_error: "Could not find input",
  send_button_disabled: "Could not send prompt",
  user_interference: "Session interrupted by user",
  rate_limited: "Rate limited",
  captcha: "CAPTCHA required",
  demo_error: "Demo error",
  config_error: "Selector config error",
  send_failed: "Failed to send prompt",
  cancelled: "Cancelled",
  timeout: "Timed out"
};

export function formatAppName(appKey: AppKey): string {
  return getSupportedApp(appKey).displayName;
}

export function formatErrorReason(errorReason?: string): string {
  if (!errorReason) return "Unknown error";
  return ERROR_LABELS[errorReason] ?? errorReason;
}

export function formatAgentStatus(status: AgentStatus, errorReason?: AgentErrorReason | string): string {
  if (status === "error" && errorReason) {
    return formatErrorReason(errorReason);
  }

  return STATUS_LABELS[status];
}

export function formatSessionStatus(status: SessionStatus): string {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function truncateText(text: string, maxLength: number): string {
  const clean = text.replace(/\s+/g, " ").trim();

  if (clean.length <= maxLength) {
    return clean;
  }

  return `${clean.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

export function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(timestamp));
}

export function formatCharacterCount(count: number, max: number): string {
  return `${count.toLocaleString()} / ${max.toLocaleString()}`;
}
