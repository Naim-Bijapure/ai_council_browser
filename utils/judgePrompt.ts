import { getSupportedApp } from "./appRegistry";
import type { AgentResult } from "./types";

const JUDGE_PROMPT_LIMIT = 15_000;
const SEVERE_AGENT_LIMIT = 2_000;
const TRIM_SUFFIX = "...";
const MIN_TRIMMED_SECTION_LENGTH = SEVERE_AGENT_LIMIT + TRIM_SUFFIX.length;
const MAX_TRIM_ITERATIONS = 64;

interface BuildJudgePromptInput {
  prompt: string;
  agentResults: AgentResult[];
}

export interface JudgePromptResult {
  text: string;
  trimmed: boolean;
  severelyTrimmed: boolean;
}

export function buildJudgePrompt(input: BuildJudgePromptInput): JudgePromptResult {
  const sections = input.agentResults.map(formatAgentResult);
  let note = "";
  let text = composePrompt(input.prompt, sections, note);
  let trimmed = false;
  let severelyTrimmed = false;

  if (text.length > JUDGE_PROMPT_LIMIT) {
    trimmed = true;
    note = "[Note: Some agent responses were trimmed to fit within length limits.]";
    const trimmedSections = trimLongestSections(input.prompt, sections, note);
    text = composePrompt(input.prompt, trimmedSections, note);

    if (text.length > JUDGE_PROMPT_LIMIT) {
      severelyTrimmed = true;
      const cappedSections = trimmedSections.map((section) =>
        section.length > SEVERE_AGENT_LIMIT ? `${section.slice(0, SEVERE_AGENT_LIMIT)}...` : section
      );
      text = composePrompt(input.prompt, cappedSections, note);
    }
  }

  return { text, trimmed, severelyTrimmed };
}

export async function buildJudgePromptAsync(input: BuildJudgePromptInput): Promise<JudgePromptResult> {
  await Promise.resolve();
  return buildJudgePrompt(input);
}

function composePrompt(prompt: string, agentSections: string[], note: string): string {
  return `You are the Council Judge — an expert adjudicator. Several AI models each
answered the user's question INDEPENDENTLY, without seeing each other's work. Your job
is to weigh their answers against each other and produce the single best, most reliable
response for the user. You are writing the final answer the user will actually rely on.

---

Original question:
${prompt}

---

Agent responses (each labelled with the model that produced it):

${agentSections.join("\n\n")}

${note ? `${note}\n\n` : ""}---

How to judge:
- Judge on correctness and evidence, NOT popularity. A single well-reasoned answer can
  outweigh a majority — do not assume the consensus is correct.
- Actively look for and discard hallucinations, unsupported claims, and factual or
  logical errors. Call them out explicitly and attribute them to the model by name.
- Distinguish real agreement (models independently reach the same well-founded point)
  from shallow agreement (they repeat the same assumption that may be wrong).
- For each genuine disagreement, decide which model is right and explain WHY using the
  reasoning/evidence — or state clearly that it is genuinely uncertain.
- Add any critical fact, caveat, or consideration that NONE of the models raised.
- Ignore agents that failed to respond; judge only the substantive answers. If no agent
  produced a usable answer, say so and answer the question yourself as best you can.

Output your response in EXACTLY this structure, using Markdown headings:

## Answer
The best, most COMPLETE answer to the user's question — written as if it is your own
answer, not a summary of others. Merge the strongest, verified points from ALL models
into one thorough response: if one model covered a detail the others missed and it is
correct, include it. Be detailed and concrete; use sub-bullets or short sub-sections
where the topic warrants it. Do not shorten a good answer just to be brief — depth and
completeness matter more than brevity here.

## Rejected / False Content
A bullet list of every claim you discarded, one bullet per issue, in the form:
- **<Model name>**: "<the claim, quoted or tightly paraphrased>" — why it is wrong
  (hallucination, factually incorrect, outdated, unsupported, contradicted by other
  models, or irrelevant filler).
Include weak/misleading framing and fabricated specifics (fake numbers, names, URLs,
APIs), not just outright falsehoods. If nothing needed rejecting, write exactly:
"None — no false or unsupported content detected."

## Model Comparison
2-4 tight bullets: which model(s) gave the strongest answer and why, where they
genuinely agreed, and how you resolved any real disagreement (who was right and on
what basis). Mention any model that failed or returned nothing usable.`;
}

function formatAgentResult(result: AgentResult): string {
  const appName = getSupportedApp(result.agentKey).displayName;

  if (result.status === "done") {
    return `### ${appName}\n${result.responseText}`;
  }

  if (result.status === "timeout") {
    return `### ${appName}\n[No response - this agent timed out.]`;
  }

  return `### ${appName}\n[No response - this agent encountered an error: ${result.errorReason ?? "unknown"}.]`;
}

function trimLongestSections(prompt: string, sections: string[], note: string): string[] {
  const nextSections = [...sections];

  for (let iteration = 0; iteration < MAX_TRIM_ITERATIONS; iteration++) {
    const composedLength = composePrompt(prompt, nextSections, note).length;
    if (composedLength <= JUDGE_PROMPT_LIMIT) {
      break;
    }

    let longestIndex = 0;
    nextSections.forEach((section, index) => {
      if (section.length > nextSections[longestIndex].length) {
        longestIndex = index;
      }
    });

    const longest = nextSections[longestIndex];
    if (longest.length <= MIN_TRIMMED_SECTION_LENGTH) {
      break;
    }

    const reduceBy = Math.max(250, Math.ceil((composedLength - JUDGE_PROMPT_LIMIT) / 2));
    const targetLength = Math.max(SEVERE_AGENT_LIMIT, longest.length - reduceBy);
    const trimmed = `${longest.slice(0, targetLength)}${TRIM_SUFFIX}`;
    if (trimmed.length >= longest.length) {
      break;
    }

    nextSections[longestIndex] = trimmed;
  }

  return nextSections;
}
