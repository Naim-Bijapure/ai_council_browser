import { getRelayJudgePromptTemplate } from "./relayJudgePromptTemplates";
import { getSupportedApp } from "./appRegistry";
import type { AgentResult } from "./types";

const REVIEWER_PROMPT_LIMIT = 15_000;
const DRAFT_TRIM_TARGET = 8_000;
const SEVERE_DRAFT_LIMIT = 2_000;

export interface RelayPromptResult {
  text: string;
  trimmed: boolean;
}

export function buildAuthorPrompt(question: string): string {
  return question.trim();
}

interface BuildReviewerPromptInput {
  question: string;
  previousDraft: string;
  reviewerName: string;
  stepIndex: number;
}

export function buildReviewerPrompt(input: BuildReviewerPromptInput): RelayPromptResult {
  let draft = input.previousDraft;
  let trimmed = false;
  let note = "";

  const compose = (draftText: string, noteText: string): string =>
    composeReviewerPrompt(input, draftText, noteText);

  let text = compose(draft, note);

  if (text.length > REVIEWER_PROMPT_LIMIT) {
    trimmed = true;
    note = "[Note: The previous answer was trimmed to fit within length limits.]";
    draft = trimDraft(draft, REVIEWER_PROMPT_LIMIT - compose("", note).length);
    text = compose(draft, note);

    if (text.length > REVIEWER_PROMPT_LIMIT) {
      draft = draft.slice(0, SEVERE_DRAFT_LIMIT) + "...";
      text = compose(draft, note);
    }
  }

  return { text, trimmed };
}

function composeReviewerPrompt(
  input: BuildReviewerPromptInput,
  previousDraft: string,
  note: string
): string {
  return `You are ${input.reviewerName}, reviewing another AI's answer in a relay critique chain (step ${input.stepIndex}).

Your job:
1. Critique the previous answer — flag factual errors, unsupported claims, missing considerations, weak reasoning, and hallucinations. Be specific.
2. Produce an improved, corrected answer that keeps what was right and fixes what was wrong.

Original question:
${input.question}

Previous answer to review:
${previousDraft}

${note ? `${note}\n\n` : ""}Respond with EXACTLY these two Markdown sections:

## Critique
Your detailed critique of the previous answer.

## Revised answer
Your improved, complete answer to the original question.`;
}

function trimDraft(draft: string, maxChars: number): string {
  if (draft.length <= maxChars) return draft;
  return `${draft.slice(0, Math.max(SEVERE_DRAFT_LIMIT, maxChars))}...`;
}

const RELAY_JUDGE_PROMPT_LIMIT = 15_000;
const SEVERE_STEP_LIMIT = 2_000;
const JUDGE_STEP_CONTENT_LIMIT = 4_000;
const JUDGE_FINAL_DRAFT_LIMIT = 6_000;
const TRIM_SUFFIX = "...";
const MIN_TRIMMED_SECTION_LENGTH = SEVERE_STEP_LIMIT + TRIM_SUFFIX.length;
const MAX_TRIM_ITERATIONS = 64;

interface BuildRelayJudgePromptInput {
  prompt: string;
  agentResults: AgentResult[];
  finalDraft: string;
  templateId?: string;
}

export interface RelayJudgePromptResult {
  text: string;
  trimmed: boolean;
}

export function buildRelayJudgePrompt(input: BuildRelayJudgePromptInput): RelayJudgePromptResult {
  const composeFn = getRelayJudgePromptTemplate(input.templateId).compose;
  let stepSections = input.agentResults.map(formatRelayStep);
  let finalDraft = truncateForJudgeStep(input.finalDraft, JUDGE_FINAL_DRAFT_LIMIT);
  let note = "";
  let text = composeFn(input.prompt, stepSections, finalDraft, note);
  let trimmed = finalDraft.length < input.finalDraft.length;

  if (text.length > RELAY_JUDGE_PROMPT_LIMIT) {
    trimmed = true;
    note = "[Note: Some relay chain steps were trimmed to fit within length limits.]";
    stepSections = trimRelaySections(input.prompt, stepSections, finalDraft, note, composeFn);
    text = composeFn(input.prompt, stepSections, finalDraft, note);

    if (text.length > RELAY_JUDGE_PROMPT_LIMIT) {
      stepSections = stepSections.map((section) =>
        section.length > MIN_TRIMMED_SECTION_LENGTH
          ? `${section.slice(0, SEVERE_STEP_LIMIT)}${TRIM_SUFFIX}`
          : section
      );
      text = composeFn(input.prompt, stepSections, finalDraft, note);
    }

    if (text.length > RELAY_JUDGE_PROMPT_LIMIT) {
      finalDraft = trimDraft(
        finalDraft,
        Math.max(
          SEVERE_DRAFT_LIMIT,
          RELAY_JUDGE_PROMPT_LIMIT - composeFn(input.prompt, stepSections, "", note).length - 500
        )
      );
      text = composeFn(input.prompt, stepSections, finalDraft, note);
    }
  }

  return { text, trimmed };
}

export async function buildRelayJudgePromptAsync(
  input: BuildRelayJudgePromptInput
): Promise<RelayJudgePromptResult> {
  await Promise.resolve();
  return buildRelayJudgePrompt(input);
}

function truncateForJudgeStep(text: string, limit = JUDGE_STEP_CONTENT_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}${TRIM_SUFFIX}`;
}

function formatRelayStep(result: AgentResult): string {
  const appName = getSupportedApp(result.agentKey).displayName;
  const role = result.relayRole === "author" ? "Author" : "Reviewer";

  if (result.status === "done") {
    const parts = [`### Step — ${appName} (${role})`];
    if (result.critiqueText) {
      parts.push(`**Critique:**\n${truncateForJudgeStep(result.critiqueText)}`);
    }
    const answer = result.revisedAnswerText ?? result.responseText;
    parts.push(`**Revised answer:**\n${truncateForJudgeStep(answer)}`);
    return parts.join("\n\n");
  }

  if (result.status === "skipped") {
    return `### Step — ${appName} (${role})\n[Skipped — draft passed through unchanged.]`;
  }

  if (result.status === "timeout") {
    return `### Step — ${appName} (${role})\n[No response — this step timed out.]`;
  }

  return `### Step — ${appName} (${role})\n[No response — error: ${result.errorReason ?? "unknown"}.]`;
}

function trimRelaySections(
  prompt: string,
  sections: string[],
  finalDraft: string,
  note: string,
  composeFn: (prompt: string, stepSections: string[], finalDraft: string, note: string) => string
): string[] {
  const next = [...sections];

  for (let iteration = 0; iteration < MAX_TRIM_ITERATIONS; iteration++) {
    const composedLength = composeFn(prompt, next, finalDraft, note).length;
    if (composedLength <= RELAY_JUDGE_PROMPT_LIMIT) {
      break;
    }

    let longestIndex = 0;
    next.forEach((section, index) => {
      if (section.length > next[longestIndex].length) {
        longestIndex = index;
      }
    });

    const longest = next[longestIndex];
    if (longest.length <= MIN_TRIMMED_SECTION_LENGTH) {
      break;
    }

    const reduceBy = Math.max(250, Math.ceil((composedLength - RELAY_JUDGE_PROMPT_LIMIT) / 2));
    const targetLength = Math.max(SEVERE_STEP_LIMIT, longest.length - reduceBy);
    const trimmed = `${longest.slice(0, targetLength)}${TRIM_SUFFIX}`;
    if (trimmed.length >= longest.length) {
      break;
    }

    next[longestIndex] = trimmed;
  }

  return next;
}
