export interface PromptRefinerJudgePromptTemplate {
  id: string;
  name: string;
  description: string;
  compose: (prompt: string, stepSections: string[], finalDraft: string, note: string) => string;
}

const PREAMBLE = (role: string, mission: string) =>
  `You are the ${role} — the final step in a prompt-refinement chain. Several AI models improved the user's original prompt step by step: a drafter produced an enhanced version, then each enhancer refined it further. Your job is ${mission}.

Remember: the deliverable is an ENHANCED PROMPT, not an answer to it. Never answer the prompt. Preserve the user's original intent — improve how it is asked, not what is asked. Be comprehensive but not bloated.

---

User's original raw prompt:
\${prompt}

---

Latest enhanced prompt (output of the last refinement step):
\${finalDraft}

---

Refinement chain (each step's notes and enhanced prompt):

\${stepSections}

\${note}---

`;

function tpl(role: string, mission: string, judging: string, structure: string): PromptRefinerJudgePromptTemplate["compose"] {
  const preamble = PREAMBLE(role, mission);
  return (prompt, stepSections, finalDraft, note) => {
    const body = preamble
      .replace("${prompt}", prompt)
      .replace("${finalDraft}", finalDraft)
      .replace("${stepSections}", stepSections.join("\n\n"))
      .replace("${note}", note ? `${note}\n\n` : "");
    return body + judging + "\n\nOutput your response in EXACTLY this structure, using Markdown headings:\n\n" + structure;
  };
}

const READY_TO_USE = tpl(
  "Prompt Finalizer",
  "to merge the best improvements from the chain into a single, polished, ready-to-use prompt",
  `How to finalize:
- Start from the latest enhanced prompt, but fold in any stronger ideas from earlier steps that were later dropped.
- Ensure it fully captures the user's intent and adds real value (context, structure, constraints, output format) without padding.
- Remove redundancy, contradictions, and filler. Fix any awkward wording.
- The result must be self-contained and pasteable into any AI as-is.`,
  `## Enhanced prompt
The single best final prompt, as clean ready-to-use text. This is the only thing the user will copy — no commentary, no headings inside it, just the prompt.`
);

const STRUCTURED = tpl(
  "Prompt Architect",
  "to assemble the improvements into a clearly structured, section-based prompt",
  `How to finalize:
- Organize the final prompt into labeled sections so it is unambiguous and complete.
- Include only sections that add value for this specific request; omit any that would be empty or noise.
- Keep the user's intent central; do not invent requirements.`,
  `## Enhanced prompt
A structured, ready-to-use prompt using clearly labeled parts, for example:
- **Role:** who the AI should act as (if useful)
- **Context:** relevant background
- **Task:** the core request, with sub-tasks if needed
- **Constraints:** scope, what to include/exclude
- **Output format:** structure, length, and style expected
Write it so the whole block can be pasted into any AI as-is.`
);

const WITH_RATIONALE = tpl(
  "Prompt Editor",
  "to deliver the final prompt plus a short explanation of the key improvements",
  `How to finalize:
- Produce the best final prompt (merging the strongest improvements), then briefly explain what makes it better than the original.
- Keep the rationale short and practical — it is secondary to the prompt itself.`,
  `## Enhanced prompt
The single best final prompt, as clean ready-to-use text — no commentary inside it.

## Key improvements
3-6 bullets on the most important upgrades over the user's original prompt (clarity, added context, structure, constraints, output format, etc.).`
);

export const PROMPT_REFINER_JUDGE_PROMPT_TEMPLATES: PromptRefinerJudgePromptTemplate[] = [
  { id: "refiner-ready", name: "Ready-to-Use Prompt", description: "Default — one polished, pasteable prompt merging the best of the chain", compose: READY_TO_USE },
  { id: "refiner-structured", name: "Structured Prompt", description: "A section-based prompt (Role, Context, Task, Constraints, Output format)", compose: STRUCTURED },
  { id: "refiner-rationale", name: "Prompt + Rationale", description: "The final prompt plus a short list of the key improvements made", compose: WITH_RATIONALE }
];

export const DEFAULT_PROMPT_REFINER_JUDGE_PROMPT_TEMPLATE_ID = "refiner-ready";

export function getPromptRefinerJudgePromptTemplate(id?: string): PromptRefinerJudgePromptTemplate {
  if (!id) return PROMPT_REFINER_JUDGE_PROMPT_TEMPLATES[0];
  return PROMPT_REFINER_JUDGE_PROMPT_TEMPLATES.find((t) => t.id === id) ?? PROMPT_REFINER_JUDGE_PROMPT_TEMPLATES[0];
}
