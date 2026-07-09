import type { AppKey, DebatePhase } from "./types";

export const MIN_DEBATE_ROUNDS = 1;
export const MAX_DEBATE_ROUNDS = 4;
export const DEFAULT_DEBATE_ROUNDS = 1;

export interface DebateTurnSpec {
  agentKey: AppKey;
  round: number;
  phase: DebatePhase;
}

/** Clamp a (possibly untrusted) rounds value into the allowed range. */
export function clampDebateRounds(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_DEBATE_ROUNDS;
  return Math.min(MAX_DEBATE_ROUNDS, Math.max(MIN_DEBATE_ROUNDS, n));
}

/**
 * Expand a debate into its ordered turn sequence:
 *   - one opening pass (each debater states a position), then
 *   - one rebuttal pass per round (each debater counters the others).
 * Every pass goes through the debaters top-to-bottom in list order.
 */
export function buildDebateTurns(debaters: AppKey[], rounds: number): DebateTurnSpec[] {
  const safeRounds = clampDebateRounds(rounds);
  const turns: DebateTurnSpec[] = [];

  for (const agentKey of debaters) {
    turns.push({ agentKey, round: 1, phase: "opening" });
  }

  for (let round = 1; round <= safeRounds; round++) {
    for (const agentKey of debaters) {
      turns.push({ agentKey, round, phase: "rebuttal" });
    }
  }

  return turns;
}
