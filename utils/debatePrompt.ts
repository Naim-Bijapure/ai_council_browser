import { getDebateJudgePromptTemplate } from "./debateJudgePromptTemplates";
import { getSupportedApp } from "./appRegistry";
import type { AgentResult, DebatePhase } from "./types";

// ---------------------------------------------------------------------------
// Debate — debaters state positions, then counter each other over N rounds,
// then a moderator judge delivers the verdict. A running transcript is carried
// into every turn's prompt; per-turn word budgets keep it bounded.
// ---------------------------------------------------------------------------

const OPENING_WORD_TARGET = 350;
const REBUTTAL_WORD_TARGET = 300;

const TURN_PROMPT_LIMIT = 15_000;
const TRANSCRIPT_LIMIT = 10_000;
const PER_ENTRY_LIMIT = 1_600;
const SEVERE_TRANSCRIPT_LIMIT = 3_000;
const TRIM_SUFFIX = "...";

export interface DebateTranscriptEntry {
  speaker: string;
  round: number;
  phase: DebatePhase;
  text: string;
}

export interface DebateTurnPromptResult {
  text: string;
  trimmed: boolean;
}

interface BuildDebateTurnPromptInput {
  question: string;
  speakerName: string;
  transcript: DebateTranscriptEntry[];
  phase: DebatePhase;
  round: number;
}

function entryHeader(entry: DebateTranscriptEntry): string {
  const phaseLabel = entry.phase === "opening" ? "Opening" : `Rebuttal (round ${entry.round})`;
  return `${entry.speaker} — ${phaseLabel}`;
}

/**
 * Formats the transcript for a turn/judge prompt, trimming to fit a char
 * budget. Oldest entries are trimmed first; the most recent stay fullest.
 */
function formatTranscript(entries: DebateTranscriptEntry[], limit: number): string {
  if (entries.length === 0) return "";

  // Start from per-entry truncation, then, if still over budget, trim from the
  // oldest entries (front) since recent arguments matter most.
  let formatted = entries.map((e) => `### ${entryHeader(e)}\n${truncate(e.text, PER_ENTRY_LIMIT)}`);
  let joined = formatted.join("\n\n");
  if (joined.length <= limit) return joined;

  let startIndex = 0;
  while (joined.length > limit && startIndex < formatted.length - 1) {
    startIndex++;
    const kept = formatted.slice(startIndex);
    joined = `[Earlier turns omitted to fit length limits.]\n\n${kept.join("\n\n")}`;
  }

  if (joined.length > limit) {
    joined = joined.slice(0, limit) + TRIM_SUFFIX;
  }
  return joined;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}${TRIM_SUFFIX}`;
}

export function buildDebateTurnPrompt(input: BuildDebateTurnPromptInput): DebateTurnPromptResult {
  const hasTranscript = input.transcript.length > 0;
  let transcriptLimit = TRANSCRIPT_LIMIT;
  let transcriptText = formatTranscript(input.transcript, transcriptLimit);
  let trimmed = false;

  const compose = (transcriptBlock: string): string => {
    if (input.phase === "opening") {
      const priorBlock = hasTranscript
        ? `Debaters who have already opened (you may acknowledge or challenge them, but focus on making your own case):\n\n${transcriptBlock}\n\n`
        : "";
      return `You are ${input.speakerName}, a participant in a structured debate. Give your OPENING statement on the topic below.

Take a clear, well-reasoned position and argue for it with your strongest points and evidence. Be persuasive but honest — no fabricated facts. Keep it under ~${OPENING_WORD_TARGET} words.

Debate topic:
${input.question.trim()}

${priorBlock}State your position and argue it. Do not write a neutral summary — take a stance.`;
    }

    return `You are ${input.speakerName} in an ongoing debate (rebuttal, round ${input.round}). Below is the debate so far.

Your job: directly REBUT the other debaters — expose weak arguments, unsupported claims, and flawed reasoning — then reinforce your own position against their strongest points. Be specific and reference what others actually said. Keep it under ~${REBUTTAL_WORD_TARGET} words.

Debate topic:
${input.question.trim()}

Debate so far:
${transcriptBlock}

Give your rebuttal. Attack the weakest points of the opposing arguments and defend your stance.`;
  };

  let text = compose(transcriptText);

  if (text.length > TURN_PROMPT_LIMIT) {
    trimmed = true;
    transcriptLimit = Math.max(SEVERE_TRANSCRIPT_LIMIT, TURN_PROMPT_LIMIT - compose("").length);
    transcriptText = formatTranscript(input.transcript, transcriptLimit);
    text = compose(transcriptText);

    if (text.length > TURN_PROMPT_LIMIT) {
      transcriptText = transcriptText.slice(0, SEVERE_TRANSCRIPT_LIMIT) + TRIM_SUFFIX;
      text = compose(transcriptText);
    }
  }

  return { text, trimmed };
}

// ---------------------------------------------------------------------------
// Judge (moderator) — reads the full transcript and delivers the outcome.
// ---------------------------------------------------------------------------
const JUDGE_PROMPT_LIMIT = 15_000;
const JUDGE_TRANSCRIPT_LIMIT = 12_000;

interface BuildDebateJudgePromptInput {
  prompt: string;
  agentResults: AgentResult[];
  templateId?: string;
}

export interface DebateJudgePromptResult {
  text: string;
  trimmed: boolean;
}

export function buildDebateJudgePrompt(input: BuildDebateJudgePromptInput): DebateJudgePromptResult {
  const composeFn = getDebateJudgePromptTemplate(input.templateId).compose;
  const entries = agentResultsToTranscript(input.agentResults);

  let limit = JUDGE_TRANSCRIPT_LIMIT;
  let transcriptText = formatTranscript(entries, limit);
  let note = "";
  let text = composeFn(input.prompt, transcriptText, note);
  let trimmed = false;

  if (text.length > JUDGE_PROMPT_LIMIT) {
    trimmed = true;
    note = "[Note: Parts of the transcript were trimmed to fit within length limits.]";
    limit = Math.max(SEVERE_TRANSCRIPT_LIMIT, JUDGE_PROMPT_LIMIT - composeFn(input.prompt, "", note).length);
    transcriptText = formatTranscript(entries, limit);
    text = composeFn(input.prompt, transcriptText, note);

    if (text.length > JUDGE_PROMPT_LIMIT) {
      transcriptText = transcriptText.slice(0, SEVERE_TRANSCRIPT_LIMIT) + TRIM_SUFFIX;
      text = composeFn(input.prompt, transcriptText, note);
    }
  }

  return { text, trimmed };
}

export async function buildDebateJudgePromptAsync(
  input: BuildDebateJudgePromptInput
): Promise<DebateJudgePromptResult> {
  await Promise.resolve();
  return buildDebateJudgePrompt(input);
}

function agentResultsToTranscript(results: AgentResult[]): DebateTranscriptEntry[] {
  return results
    .filter((r) => r.status === "done" && r.responseText.trim())
    .map((r) => ({
      speaker: getSupportedApp(r.agentKey).displayName,
      round: r.debateRound ?? 1,
      phase: r.debatePhase ?? "opening",
      text: r.responseText.trim()
    }));
}
