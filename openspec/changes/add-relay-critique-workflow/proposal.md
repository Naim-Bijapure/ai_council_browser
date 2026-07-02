# Proposal: Relay-Critique Workflow (agent → agent chain)

Status: Draft (planning only — no code yet)

## Why

Today the app has exactly one workflow: **Council**. Every selected agent answers
the same question *independently and in isolation*, then a single judge synthesizes
all answers. This is great for breadth (many independent perspectives at once), but
it has a blind spot: no agent ever *sees or challenges* another agent's reasoning.
Errors that a second model would immediately catch survive into the judge stage, and
the judge only sees final answers, not a back-and-forth.

A second workflow — **Relay-Critique** — covers the opposite axis: depth through
iteration. One agent answers, the next agent *critiques and improves* that answer,
the next critiques *that*, and so on down an ordered chain. Instead of N parallel
opinions merged once, you get one answer refined N times, with each model acting as
a reviewer of the previous step. This surfaces mistakes, sharpens reasoning, and
produces a single answer that has already been stress-tested before it reaches the
user.

Letting the user choose the workflow on the UI means the same agent roster can be
used either way depending on the task (breadth vs. depth).

## What Changes (conceptual — not implemented in this proposal)

- Introduce a **workflow type** the user selects before running: `council` (existing)
  or `relay` (new). Default stays `council` so nothing changes for current users.
- In **Relay** mode:
  - The selected agents form an **ordered chain** (order matters; the UI lets the
    user reorder them).
  - **Step 1 (author):** the first agent answers the original question normally.
  - **Steps 2…N (reviewers):** each subsequent agent receives the original question
    **plus the previous step's answer**, and is asked to (a) critique it — flag
    errors, gaps, weak reasoning, unsupported claims — and (b) produce an improved
    revised answer.
  - The **final step's revised answer** is the result shown to the user. The full
    chain (each step's critique + revision) is retained and viewable.
  - **Optional final judge:** the user may additionally pick a judge that receives
    the original question and the *final* refined answer (and optionally the chain)
    to produce a clean closing verdict. If no judge is selected, the last agent's
    answer is the final output.
- The **run view** renders the chain as ordered steps (Author → Reviewer 2 →
  Reviewer 3 → …), each showing its critique and its revised answer, mirroring how
  Council currently renders per-agent cards.

## Proposed Flow

```
User picks: workflow = "relay", ordered agents [A, B, C], optional judge = J

  A: answer(question)                         -> draft_1
  B: critique+revise(question, draft_1)       -> critique_B, draft_2
  C: critique+revise(question, draft_2)       -> critique_C, draft_3   (final refined)
  J (optional): verdict(question, draft_3)    -> final_output
                                                 (else final_output = draft_3)
```

Compared with the existing Council flow:

```
Council:  A,B,C answer(question) independently  ->  J synthesizes(all answers)
Relay:    A answers -> B refines -> C refines    -> (optional) J finalizes
```

## Reuse of existing machinery

This workflow is intended to be **mostly orchestration**, reusing what already exists:

- The same per-agent automation (`runAgent` inject + capture) drives each step. A
  relay step is just "inject a prompt into agent X, capture its response" — identical
  to a council agent turn.
- The same sequential single-popup window flow (open → inject → capture → next) is
  reused; relay is naturally sequential because each step depends on the previous.
- Only the **prompt content per step** differs (author prompt vs. critique+revise
  prompt), plus the ordered-chain bookkeeping.

## UI Sketch

- A small **workflow toggle** at the top of the run form: `Council` | `Relay critique`.
- When `Relay` is selected:
  - The agent list becomes an **ordered** list (drag handle or up/down arrows) with a
    role hint (`#1 Author`, `#2 Reviewer`, …).
  - The judge selector becomes **optional** and is relabeled (e.g. "Final judge
    (optional)").
- When `Council` is selected: UI is exactly as today.

## Data Model (sketch — for the eventual implementation)

- Add `workflowType: "council" | "relay"` to the run request and stored session.
- For relay, store an ordered `steps[]`: `{ agentKey, role: "author" | "reviewer",
  critique?: string, answer: string, status, timings }`.
- Council sessions are unchanged; `workflowType` defaults to `"council"` for old
  records.

## Prompt Shapes (draft wording — to refine during implementation)

- **Author (step 1):** the raw user question (as today for a single agent).
- **Reviewer (step k):**
  > You are reviewing another AI's answer to the question below. First, critique it:
  > point out any errors, unsupported claims, missing considerations, or weak
  > reasoning — be specific. Then produce an improved, corrected answer that keeps
  > what was right and fixes what was wrong.
  >
  > Question: `<original question>`
  >
  > Previous answer to review: `<draft_{k-1}>`
  >
  > Respond with two clearly labeled sections: **Critique** and **Revised answer**.
- **Final judge (optional):** reuse the improved judge prompt, fed the final refined
  answer (and optionally the critique chain).

## Open Questions

- Should reviewers see only the immediately-previous answer, or the full history so
  far? (Start with previous-only for simplicity and token cost.)
- Parsing the reviewer output into `critique` vs `revised answer` — rely on the
  labeled sections, or keep the whole text and just display it? (Start: keep whole
  text, display as-is; optionally split on the section headers for the "final answer"
  extraction.)
- Chain length / cost guardrails (each step is a full round-trip; long chains are
  slow). Consider a soft cap and a note in the UI.
- What is the "final answer" when no judge is selected — the last revised answer.
  Confirm that is the desired default.

## Impact (when implemented — for reference, not this proposal)

- `utils/types.ts` — `workflowType` on run request / session; relay step types.
- `utils/judgePrompt.ts` (or a new `relayPrompt.ts`) — reviewer prompt builder.
- `utils/automation/councilRunner.ts` — a relay branch that chains steps instead of
  the parallel-answers-then-judge flow.
- `entrypoints/sidepanel/App.tsx` — workflow toggle, ordered agent list, optional
  judge; relay run view.
- `utils/history.ts` / storage — persist and render relay sessions.
- No new browser permissions (reuses existing tab/window + messaging).

## Non-Goals

- No change to the Council workflow's behavior.
- No automatic workflow selection — the user explicitly chooses.
- No multi-branch debate/tournament structures in this proposal (possible future
  work); this is a single linear chain.
