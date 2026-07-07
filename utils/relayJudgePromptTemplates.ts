export interface RelayJudgePromptTemplate {
  id: string;
  name: string;
  description: string;
  compose: (prompt: string, stepSections: string[], finalDraft: string, note: string) => string;
}

const PREAMBLE = (role: string, mission: string) =>
  `You are the ${role} — the final arbiter in a sequential critique chain. Several AI models refined one answer step by step: the first answered the question, then each subsequent model critiqued and revised the previous draft. ${mission}.

---

Original question:
\${prompt}

---

Final refined draft (output of the last successful relay step):
\${finalDraft}

---

Relay chain (each step's critique and revision):

\${stepSections}

\${note}---

`;

function tpl(role: string, mission: string, judging: string, structure: string): RelayJudgePromptTemplate["compose"] {
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

const ARBITER = tpl(
  "Relay Judge",
  "Your job is to produce the single best, most reliable final response for the user",
  `How to judge:
- Treat the final refined draft as your starting point, not something to discard lightly.
- Verify it against the critique history — ensure corrections were applied and no new errors crept in.
- Discard any remaining hallucinations, unsupported claims, or logical errors surfaced in the chain.
- Add any critical fact, caveat, or consideration the chain missed.
- Ignore relay steps that failed or were skipped; judge only substantive contributions.`,
  `## Answer
The definitive answer to the user's question — written as your own complete response, not a meta-summary of the relay process. Merge verified improvements from the chain.

## Corrections Applied
A bullet list of the most important fixes you kept or added from the relay chain. If nothing needed changing, write: "None — the final draft was sound."

## Chain Assessment
2-4 bullets: which relay steps added the most value, what major errors were caught, and whether the final draft is trustworthy.`
);

const VALIDATOR = tpl(
  "Relay Validator",
  "Your job is to rigorously audit the chain and ensure the final output is correct, complete, and trustworthy",
  `How to judge:
- Verify EVERY critique from the chain was actually addressed in subsequent steps. If a reviewer flagged an issue and later revisions ignored it, flag it explicitly.
- Check for "drift": did later revisions accidentally remove correct information that earlier steps added? Trace what was lost.
- Cross-check the final draft against the original question — does it ACTUALLY answer what was asked, or did the answer drift off-topic through revisions?
- Flag any remaining hallucinations, unsupported claims, missing citations, or logical gaps in the final draft.
- Be strict and honest: if the final answer still has significant problems, say so clearly rather than papering over them.
- Ignore failed/skipped steps.`,
  `## Answer
The corrected, definitive answer. Fix any remaining issues you identified.

## Validation Report
Per-step assessment: for each review step in the chain, state whether its critiques were addressed and whether the revision introduced any regression.

## Unresolved Issues
Any problems that remain in the final draft — errors, gaps, weak reasoning, unsupported claims. If none, state "None."

## Verdict
"RELIABLE" (fully trustworthy), "MINOR ISSUES" (usable but with noted caveats), or "UNRELIABLE" (significant problems remain — explain why and what the user should watch out for).`
);

const FINALIZER = tpl(
  "Relay Finalizer",
  "Your job is to produce the single cleanest, most direct final answer — no commentary, no chain summary",
  `How to judge:
- Produce the best possible answer to the original question. The relay chain is raw material — the user should never see or sense it exists.
- Do NOT describe what happened in the relay process. No "the chain showed," "reviewers found," or similar meta-language.
- If the final draft is good, polish it for clarity, concision, and completeness. If it has issues, fix them without drawing attention to them.
- Be direct and self-contained. The answer should read as if a single expert wrote it from scratch.
- Ignore failed/skipped steps entirely.`,
  `## Answer
The definitive, self-contained answer only. No chain commentary whatsoever. Write in your own voice as an expert — brief, precise, complete.`
);

const ANALYST = tpl(
  "Relay Chain Analyst",
  "Your job is to explain how the answer evolved step by step, what each model contributed, and deliver a corrected final answer",
  `How to judge:
- Trace the full evolution of the answer from the original author through each reviewer.
- For each step: what changed from the previous draft, was the change correct and useful, and what (if anything) was missed.
- Identify patterns: which reviewers caught real issues, which introduced noise, and whether the chain converged toward quality or drifted.
- Evaluate whether the chain method itself was effective for this question — did sequential critique actually improve the answer, or did it overcomplicate it?
- Ignore failed/skipped steps.`,
  `## Answer
The final corrected answer, incorporating all validated improvements from the chain.

## Chain Analysis
Per-step breakdown: what each model contributed, what they changed, whether their critique was valid, and whether their revision improved the answer.

## Model Contributions Summary
Ranking of which models added the most value, which introduced errors or noise, and overall verdict on the chain's effectiveness.

## Chain Verdict
"Highly effective" / "Moderately useful" / "Marginally useful" / "Counterproductive" — with a brief explanation of whether sequential critique actually helped for this question.`
);

export const RELAY_JUDGE_PROMPT_TEMPLATES: RelayJudgePromptTemplate[] = [
  { id: "relay-arbiter", name: "Relay Arbiter", description: "Default — verify the chain, merge improvements, produce final answer with corrections list", compose: ARBITER },
  { id: "relay-validator", name: "Strict Validator", description: "Rigorously audit each step — flag drift, unresolved issues, and give a reliability verdict", compose: VALIDATOR },
  { id: "relay-finalizer", name: "Concise Finalizer", description: "Just the polished final answer — no chain commentary, no corrections list, no meta-language", compose: FINALIZER },
  { id: "relay-analyst", name: "Chain Analyst", description: "Trace the full evolution — per-step analysis, model contributions, and chain effectiveness verdict", compose: ANALYST }
];

export const DEFAULT_RELAY_JUDGE_PROMPT_TEMPLATE_ID = "relay-arbiter";

export function getRelayJudgePromptTemplate(id?: string): RelayJudgePromptTemplate {
  if (!id) return RELAY_JUDGE_PROMPT_TEMPLATES[0];
  return RELAY_JUDGE_PROMPT_TEMPLATES.find((t) => t.id === id) ?? RELAY_JUDGE_PROMPT_TEMPLATES[0];
}
