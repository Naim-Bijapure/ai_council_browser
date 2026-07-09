import { getPromptRefinerJudgePromptTemplate } from "./promptRefinerJudgePromptTemplates";
import { getSupportedApp } from "./appRegistry";
import type { AgentResult } from "./types";

// ---------------------------------------------------------------------------
// Prompt Refiner — a relay-shaped chain that improves the *prompt itself*
// rather than answering it. A drafter enhances the raw prompt, enhancers
// progressively refine it, and a judge produces the final ready-to-use prompt.
// ---------------------------------------------------------------------------

const ENHANCER_PROMPT_LIMIT = 15_000;
const SEVERE_DRAFT_LIMIT = 2_000;
const TRIM_SUFFIX = "...";

export interface PromptRefinerPromptResult {
  text: string;
  trimmed: boolean;
}

// The shared "360° coverage" framework every step works from. Kept concise so
// it guides without bloating the prompt.
const COVERAGE_FRAMEWORK = `A great prompt typically makes these explicit (include what genuinely helps; omit what would be noise):
- Goal & intent: what the user actually wants and why
- Role/persona for the answering AI, when useful
- Relevant context and background
- The core task, broken into clear sub-tasks or questions if needed
- Scope & constraints: what to include and what to leave out
- Success criteria / quality bar
- Desired output format, structure, and length
- Audience and tone
- Edge cases or considerations to address
- Assumptions to state, and clarifying questions to ask if information is missing`;

const CORE_RULES = `Critical rules:
- ENHANCE the prompt — do NOT answer it. Your output is an improved prompt, not a response to it.
- PRESERVE the user's original intent. Improve how it is asked, not what is asked. Never change the subject or add requirements the user did not imply.
- Be comprehensive but NOT bloated. Every addition must earn its place; cut filler.
- Write the enhanced prompt so it can be pasted directly into any AI as-is.`;

// ---------------------------------------------------------------------------
// Drafter — first step: turns the raw prompt into an initial enhanced prompt.
// ---------------------------------------------------------------------------
export function buildDrafterPrompt(question: string): string {
  return `You are a prompt engineer. Rewrite the user's raw prompt below into a stronger, clearer, more complete prompt that will get a great answer from any AI.

${CORE_RULES}

${COVERAGE_FRAMEWORK}

User's raw prompt:
${question.trim()}

Output ONLY the enhanced prompt as clean, ready-to-use text. Do not add commentary, explanations, or headings around it.`;
}

// ---------------------------------------------------------------------------
// Enhancer — subsequent steps: refine the current enhanced prompt further.
// ---------------------------------------------------------------------------
interface BuildEnhancerPromptInput {
  question: string;
  previousDraft: string;
  enhancerName: string;
  stepIndex: number;
}

export function buildEnhancerPrompt(input: BuildEnhancerPromptInput): PromptRefinerPromptResult {
  const compose = (draft: string, note: string): string => composeEnhancerPrompt(input, draft, note);

  let draft = input.previousDraft;
  let note = "";
  let trimmed = false;
  let text = compose(draft, note);

  if (text.length > ENHANCER_PROMPT_LIMIT) {
    trimmed = true;
    note = "[Note: The previous enhanced prompt was trimmed to fit within length limits.]";
    draft = trimDraft(draft, ENHANCER_PROMPT_LIMIT - compose("", note).length);
    text = compose(draft, note);

    if (text.length > ENHANCER_PROMPT_LIMIT) {
      draft = draft.slice(0, SEVERE_DRAFT_LIMIT) + TRIM_SUFFIX;
      text = compose(draft, note);
    }
  }

  return { text, trimmed };
}

function composeEnhancerPrompt(
  input: BuildEnhancerPromptInput,
  previousDraft: string,
  note: string
): string {
  return `You are ${input.enhancerName}, improving an already-enhanced prompt in a refinement chain (step ${input.stepIndex}). Another AI produced the current version; make it better.

${CORE_RULES}

Look for what is still missing or weak, using this lens:
${COVERAGE_FRAMEWORK}

Fill real gaps, remove ambiguity, and tighten wording. If the current version is already strong, make only high-value changes rather than rewriting for its own sake.

Original raw prompt (the user's true intent — do not drift from it):
${input.question}

Current enhanced prompt to improve:
${previousDraft}

${note ? `${note}\n\n` : ""}Respond with EXACTLY these two Markdown sections:

## Notes
Briefly, what you improved and the gaps you filled.

## Enhanced prompt
The full improved prompt, ready to paste into any AI. No commentary here — just the prompt.`;
}

function trimDraft(draft: string, maxChars: number): string {
  if (draft.length <= maxChars) return draft;
  return `${draft.slice(0, Math.max(SEVERE_DRAFT_LIMIT, maxChars))}${TRIM_SUFFIX}`;
}

// ---------------------------------------------------------------------------
// Judge — produces the final enhanced prompt from the chain.
// ---------------------------------------------------------------------------
const JUDGE_PROMPT_LIMIT = 15_000;
const JUDGE_STEP_CONTENT_LIMIT = 4_000;
const JUDGE_FINAL_DRAFT_LIMIT = 6_000;
const JUDGE_SEVERE_STEP_LIMIT = 2_000;
const JUDGE_MIN_TRIMMED_SECTION = JUDGE_SEVERE_STEP_LIMIT + TRIM_SUFFIX.length;
const JUDGE_MAX_TRIM_ITERATIONS = 64;

interface BuildPromptRefinerJudgePromptInput {
  prompt: string;
  agentResults: AgentResult[];
  finalDraft: string;
  templateId?: string;
}

export interface PromptRefinerJudgePromptResult {
  text: string;
  trimmed: boolean;
}

export function buildPromptRefinerJudgePrompt(
  input: BuildPromptRefinerJudgePromptInput
): PromptRefinerJudgePromptResult {
  const composeFn = getPromptRefinerJudgePromptTemplate(input.templateId).compose;
  let stepSections = input.agentResults.map(formatRefinerStep);
  let finalDraft = truncateForJudgeStep(input.finalDraft, JUDGE_FINAL_DRAFT_LIMIT);
  let note = "";
  let text = composeFn(input.prompt, stepSections, finalDraft, note);
  let trimmed = finalDraft.length < input.finalDraft.length;

  if (text.length > JUDGE_PROMPT_LIMIT) {
    trimmed = true;
    note = "[Note: Some refinement steps were trimmed to fit within length limits.]";
    stepSections = trimLongestSections(input.prompt, stepSections, finalDraft, note, composeFn);
    text = composeFn(input.prompt, stepSections, finalDraft, note);

    if (text.length > JUDGE_PROMPT_LIMIT) {
      stepSections = stepSections.map((section) =>
        section.length > JUDGE_MIN_TRIMMED_SECTION
          ? `${section.slice(0, JUDGE_SEVERE_STEP_LIMIT)}${TRIM_SUFFIX}`
          : section
      );
      text = composeFn(input.prompt, stepSections, finalDraft, note);
    }

    if (text.length > JUDGE_PROMPT_LIMIT) {
      finalDraft = trimDraft(
        finalDraft,
        Math.max(
          SEVERE_DRAFT_LIMIT,
          JUDGE_PROMPT_LIMIT - composeFn(input.prompt, stepSections, "", note).length - 500
        )
      );
      text = composeFn(input.prompt, stepSections, finalDraft, note);
    }
  }

  return { text, trimmed };
}

export async function buildPromptRefinerJudgePromptAsync(
  input: BuildPromptRefinerJudgePromptInput
): Promise<PromptRefinerJudgePromptResult> {
  await Promise.resolve();
  return buildPromptRefinerJudgePrompt(input);
}

function truncateForJudgeStep(text: string, limit = JUDGE_STEP_CONTENT_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}${TRIM_SUFFIX}`;
}

function formatRefinerStep(result: AgentResult): string {
  const appName = getSupportedApp(result.agentKey).displayName;
  const role = result.relayRole === "author" ? "Drafter" : "Enhancer";
  const header = `### Step — ${appName} (${role})`;

  if (result.status === "done") {
    const parts = [header];
    if (result.critiqueText) {
      parts.push(`**Notes:**\n${truncateForJudgeStep(result.critiqueText)}`);
    }
    const enhanced = result.revisedAnswerText ?? result.responseText;
    parts.push(`**Enhanced prompt:**\n${truncateForJudgeStep(enhanced)}`);
    return parts.join("\n\n");
  }

  if (result.status === "skipped") {
    return `${header}\n[Skipped — enhanced prompt passed through unchanged.]`;
  }

  if (result.status === "timeout") {
    return `${header}\n[No response — this step timed out.]`;
  }

  return `${header}\n[No response — error: ${result.errorReason ?? "unknown"}.]`;
}

function trimLongestSections(
  prompt: string,
  sections: string[],
  finalDraft: string,
  note: string,
  composeFn: (prompt: string, stepSections: string[], finalDraft: string, note: string) => string
): string[] {
  const next = [...sections];

  for (let iteration = 0; iteration < JUDGE_MAX_TRIM_ITERATIONS; iteration++) {
    const composedLength = composeFn(prompt, next, finalDraft, note).length;
    if (composedLength <= JUDGE_PROMPT_LIMIT) break;

    let longestIndex = 0;
    next.forEach((section, index) => {
      if (section.length > next[longestIndex].length) longestIndex = index;
    });

    const longest = next[longestIndex];
    if (longest.length <= JUDGE_MIN_TRIMMED_SECTION) break;

    const reduceBy = Math.max(250, Math.ceil((composedLength - JUDGE_PROMPT_LIMIT) / 2));
    const targetLength = Math.max(JUDGE_SEVERE_STEP_LIMIT, longest.length - reduceBy);
    const trimmed = `${longest.slice(0, targetLength)}${TRIM_SUFFIX}`;
    if (trimmed.length >= longest.length) break;

    next[longestIndex] = trimmed;
  }

  return next;
}
