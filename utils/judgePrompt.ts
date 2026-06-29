import { getSupportedApp } from "./appRegistry";
import type { AgentResult } from "./types";

const JUDGE_PROMPT_LIMIT = 15_000;
const SEVERE_AGENT_LIMIT = 2_000;

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

function composePrompt(prompt: string, agentSections: string[], note: string): string {
  return `You are a synthesis judge. The following AI agents have each answered a question independently.
Your task is to analyse their responses, identify areas of agreement and disagreement,
and produce a final comprehensive verdict.

---

Original question:
${prompt}

---

Agent responses:

${agentSections.join("\n\n")}

${note ? `${note}\n\n` : ""}---

Your task:
1. Identify what all agents agree on
2. Highlight where they diverge and explain why the divergence matters
3. Produce a final verdict that covers all significant angles
4. Flag any blind spots, missing considerations, or caveats none of the agents addressed`;
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

  while (composePrompt(prompt, nextSections, note).length > JUDGE_PROMPT_LIMIT) {
    let longestIndex = 0;

    nextSections.forEach((section, index) => {
      if (section.length > nextSections[longestIndex].length) {
        longestIndex = index;
      }
    });

    const longest = nextSections[longestIndex];
    if (longest.length <= SEVERE_AGENT_LIMIT) {
      break;
    }

    const reduceBy = Math.max(250, Math.ceil((composePrompt(prompt, nextSections, note).length - JUDGE_PROMPT_LIMIT) / 2));
    nextSections[longestIndex] = `${longest.slice(0, Math.max(SEVERE_AGENT_LIMIT, longest.length - reduceBy))}...`;
  }

  return nextSections;
}
