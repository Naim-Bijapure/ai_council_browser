export interface DebateJudgePromptTemplate {
  id: string;
  name: string;
  description: string;
  compose: (prompt: string, transcript: string, note: string) => string;
}

const PREAMBLE = (role: string, mission: string) =>
  `You are the ${role} — the impartial moderator of a debate. Several AI debaters argued the topic below: each stated a position, then countered the others over one or more rebuttal rounds. Your job is ${mission}.

Judge on the merits — reasoning quality, evidence, and how well each debater answered rebuttals — NOT on who was most confident or verbose. Discard fabricated facts and unsupported claims regardless of who made them.

---

Debate topic:
\${prompt}

---

Full debate transcript:

\${transcript}

\${note}---

`;

function tpl(role: string, mission: string, judging: string, structure: string): DebateJudgePromptTemplate["compose"] {
  const preamble = PREAMBLE(role, mission);
  return (prompt, transcript, note) => {
    const body = preamble
      .replace("${prompt}", prompt)
      .replace("${transcript}", transcript)
      .replace("${note}", note ? `${note}\n\n` : "");
    return body + judging + "\n\nOutput your response in EXACTLY this structure, using Markdown headings:\n\n" + structure;
  };
}

const VERDICT = tpl(
  "Debate Moderator",
  "to decide which position was best argued and deliver a clear, reasoned conclusion",
  `How to judge:
- Identify the distinct positions taken and weigh the strength of the arguments on each side.
- Reward debaters who supported claims with evidence and who effectively answered the rebuttals against them.
- Penalize unsupported assertions, dodged rebuttals, and logical fallacies.
- Reach your own conclusion on the topic — do not just tally who spoke most.`,
  `## Verdict
Which position prevailed and why, in a few sentences. If it was genuinely a tie or the truth lies in between, say so and explain.

## Key Arguments
The strongest points from each side, briefly attributed to the debaters who made them.

## Conclusion
Your own reasoned answer to the debate topic, informed by the strongest arguments — written as a direct, self-contained conclusion for the user.`
);

const SYNTHESIS = tpl(
  "Debate Synthesizer",
  "to merge the strongest, best-supported points from all sides into one balanced answer — with no winner declared",
  `How to judge:
- Do NOT pick a winner. Extract the most valid, well-supported insight from every debater.
- Reconcile conflicts by reasoning about the evidence, or clearly note where genuine uncertainty remains.
- Discard weak or unsupported points regardless of who made them.`,
  `## Balanced Answer
A single, complete, even-handed answer to the topic that incorporates the strongest verified points from all debaters. Write it as your own response, not a summary of the debate.

## Points of Agreement
Where the debaters converged (and it held up).

## Unresolved Tensions
Genuine disagreements that the debate did not settle, and what each side's best case was.`
);

const SCORECARD = tpl(
  "Debate Scorekeeper",
  "to score each debater and declare a winner based on argument quality",
  `How to judge:
- Score each debater on: argument strength, use of evidence, and effectiveness of rebuttals.
- Be specific about why each score was earned; reference concrete moments from the transcript.
- Declare a winner based on the scores, not on style or verbosity.`,
  `## Scorecard
For each debater: a short assessment plus scores (out of 10) for Argument, Evidence, and Rebuttals, with a total.

## Winner
The highest-scoring debater and a one-paragraph justification.

## Best Answer
The most defensible conclusion on the topic, drawn from the winning and other strong arguments.`
);

export const DEBATE_JUDGE_PROMPT_TEMPLATES: DebateJudgePromptTemplate[] = [
  { id: "debate-verdict", name: "Verdict", description: "Default — decide which position prevailed and give a reasoned conclusion", compose: VERDICT },
  { id: "debate-synthesis", name: "Balanced Synthesis", description: "Merge the best of all sides into one answer, no winner declared", compose: SYNTHESIS },
  { id: "debate-scorecard", name: "Scorecard", description: "Score each debater on argument, evidence, and rebuttals, then name a winner", compose: SCORECARD }
];

export const DEFAULT_DEBATE_JUDGE_PROMPT_TEMPLATE_ID = "debate-verdict";

export function getDebateJudgePromptTemplate(id?: string): DebateJudgePromptTemplate {
  if (!id) return DEBATE_JUDGE_PROMPT_TEMPLATES[0];
  return DEBATE_JUDGE_PROMPT_TEMPLATES.find((t) => t.id === id) ?? DEBATE_JUDGE_PROMPT_TEMPLATES[0];
}
