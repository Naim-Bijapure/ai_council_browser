import type { ActiveCouncilSession, SessionStatus } from "./types";

const TERMINAL_SESSION_STATUSES: ReadonlySet<SessionStatus> = new Set([
  "done",
  "partial",
  "partial_failure",
  "error",
  "cancelled"
]);

export function isTerminalSession(session: ActiveCouncilSession): boolean {
  if (TERMINAL_SESSION_STATUSES.has(session.status)) {
    return true;
  }

  return session.judgeStep.status === "error" || session.judgeStep.status === "timeout";
}

export function isActiveCouncilRun(session: ActiveCouncilSession | null): boolean {
  if (!session) {
    return false;
  }

  if (isTerminalSession(session)) {
    return false;
  }

  return session.status === "running" || session.status === "judge_handoff";
}