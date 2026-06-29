# Continuing ChatGPT-DeepSeek automation foundation

**Session ID:** ses_0ecc79ec8ffeMPtvugOzJW36dg
**Created:** 6/29/2026, 5:21:29 PM
**Updated:** 6/29/2026, 5:37:52 PM

---

## User

ok pls ref this current project architecture. i will share the basc project workflow we have to achive . and also the prev llm codex session handover summary so you can continue. 

---

## Assistant (Build · DeepSeek V4 Pro · 1.8s)

---

## User

project workflow : # AI Council — Chrome Extension Workflow Specification

## Overview

AI Council is a Chrome extension that automates sending a single user prompt to multiple LLM chat applications simultaneously (agents), collects their responses, then feeds all responses into a designated judge LLM that produces a final synthesised verdict. The entire interaction happens through the frontend UIs of each chat app — no APIs are used. The extension operates via a side panel and uses tab automation via content scripts.

---

## Supported Applications

The following chat apps are supported as both agents and judge:

- ChatGPT (`chat.openai.com`)
- Claude.ai (`claude.ai`)
- Gemini (`gemini.google.com`)
- DeepSeek (`chat.deepseek.com`)
- Qwen (`chat.qwen.ai`)
- Kimi (`kimi.moonshot.cn`)

Any of the above can be configured as either an agent or the judge. The same app can be used as both an agent and the judge, but they must run in separate tabs.

---

## Extension Components

| Component | Role |
|---|---|
| Side panel | Primary user interface |
| Background service worker | Orchestrator, state machine, tab manager |
| Content scripts | Per-tab adapters injected into each chat app |
| IndexedDB | Local session history storage |
| `chrome.storage.sync` | User preferences (default agents, default judge) |

---

## User Interface — Side Panel

The side panel has two tabs: **Council** (main) and **History**.

### Council tab states

The Council tab moves through four visual states during a session:

**State 1 — Input (idle)**
- Textarea for the user's prompt
- Checkbox list of all supported agents (user selects which ones to use)
- Dropdown to select the judge app
- Submit button labelled "Run council"
- Submit is disabled if: no prompt entered, fewer than one agent selected, no judge selected

**State 2 — Execution (running)**
- Prompt is locked (not editable)
- Progress bar showing X of N agents completed
- One card per selected agent showing:
  - Agent name
  - Current status: `pending` / `injecting` / `waiting` / `done` / `timeout` / `error`
  - When status is `done`: first ~150 characters of the response as a preview
  - When status is `error` or `timeout`: short reason label
- Cards update live as each agent finishes — they do not wait for all agents
- A cancel button is visible during this state

**State 3 — Minimal / judge handoff**
- Triggered once all agents are resolved (done, timeout, or error) and the judge prompt has been injected
- Shows: "Judge is running in [App Name]"
- One button: "Switch to judge tab" — focuses the judge tab
- One button: "New question" — resets the panel to State 1
- The agent cards from State 2 remain visible above this in a collapsed/scrollable area for reference
- The panel does NOT attempt to capture or display the judge's response

**State 4 — History tab**
- A chronological list of past sessions
- Each row shows: prompt truncated to ~80 chars, timestamp, number of agents used, judge app name
- Tapping a row opens the stored judge chat URL in a new tab
- If the judge URL was not captured (capture timed out), the row shows "Judge URL unavailable" and tapping does nothing (row is visually dimmed)
- History can be cleared via a settings action

---

## Full Session Workflow

### Step 1 — User submits

User enters a prompt, selects agents, selects a judge, and clicks "Run council".

The panel immediately transitions to State 2 (execution).

The side panel sends a message to the background service worker with:
- The prompt text
- The list of selected agent keys
- The selected judge key

---

### Step 2 — Validation

The service worker validates the request before doing anything:

**Check: is the prompt non-empty?**
- Fail → send error back to panel, stay in State 1, show inline message "Please enter a prompt"

**Check: is at least one agent selected?**
- Fail → send error back to panel, stay in State 1, show inline message "Select at least one agent"

**Check: is the prompt within the length limit?**
- Maximum user prompt length: 10,000 characters
- Fail → send error back to panel, stay in State 1, show inline message "Prompt is too long (max 10,000 characters)" with the current character count visible
- The panel textarea shows a live character counter as the user types

**Check: same app as both agent and judge — are there enough tabs?**
- If e.g. Claude.ai is selected as both an agent and the judge, the orchestrator must ensure they run in separate tabs. This is handled automatically — validation passes, tab management handles it.

If all checks pass, proceed to Step 3.

---

### Step 3 — Tab preparation

For each selected agent app and the judge app, the service worker opens a new tab and waits for it to be ready.

**For agent tabs:**
- Always open a brand new tab to the app's new-chat URL. Do not reuse existing tabs, even if a tab for that app is already open. Navigating an existing tab to the new-chat URL is not sufficient — many apps restore the last session, retain in-memory context, or require a deliberate "New chat" action. A fresh tab guarantees a blank conversation.
- Wait for the tab to reach `status: complete` before proceeding (via `chrome.tabs.onUpdated`)
- Timeout per tab: 15 seconds
- If a tab fails to load within 15 seconds → mark that agent as `error: tab_load_timeout`, continue with remaining agents

**For the judge tab:**
- Always open a brand new tab to the judge app's new-chat URL
- Never reuse an existing judge tab
- The judge tab is opened early (during this step) so it has time to load while agents are running
- Wait for load same as above, with the same 15-second timeout
- If the judge tab fails to load → after all agents complete, set session status to `error: judge_tab_failed`, notify panel, save session to IndexedDB with `judgeChatUrl: null`

**Tab visibility:**
- All tabs (agents and judge) are opened as visible tabs, not background tabs
- They are not required to be the active/focused tab — they just need to be open and loaded

---

### Step 4 — Login detection

Before injecting any prompt, the content script for each tab checks whether the user is logged in to that app.

**Login detection uses a grace period, not an instant check:**
- After the tab reaches `status: complete`, the content script does not check immediately. JS-heavy apps (Gemini, DeepSeek, Qwen, Kimi) build their UI after the load event fires. Checking too early produces false `not_logged_in` errors even when the user is authenticated.
- The content script polls for the app's input element every 500ms for up to 10 seconds.
- If the input element appears within 10 seconds → user is considered logged in, proceed to injection.
- If the input element does not appear within 10 seconds → check the URL for known login/auth page patterns. If the URL matches a login page → `error: not_logged_in`. If the URL does not match a login page → `error: dom_error` (the app loaded but the UI is unrecognised).

**Login/auth URL patterns (known per app):**
- ChatGPT: `/auth/login`, `/auth/signup`
- Claude.ai: `/login`
- Gemini: `accounts.google.com`
- DeepSeek: `/sign_in`, `/sign_up`
- Qwen: login redirect domains
- Kimi: `/login`

**If not logged in:**
- Immediately set that agent's status to `error: not_logged_in`
- Send status update to panel to show this on the agent's card
- Do not attempt injection for this agent
- Continue with other agents

**If the judge tab is not logged in:**
- After agents complete, set session status to `error: judge_not_logged_in`
- Notify panel
- Save session to IndexedDB with `judgeChatUrl: null`

---

### Step 5 — Parallel agent prompt injection

**Content script readiness handshake:**
Before the service worker sends any prompt to a tab, it must confirm the content script in that tab is ready to receive messages. This is necessary because the content script is injected after the tab loads, and its message listener may not be registered at the exact moment the service worker sends the first message — causing the message to be lost and the agent to hang silently.

The handshake works as follows:
1. When the content script finishes initialising, it sends a `{ type: 'CONTENT_READY', tabId }` message to the service worker
2. The service worker registers this signal per tab ID
3. The service worker only sends the prompt to a tab after receiving its `CONTENT_READY` signal
4. If `CONTENT_READY` is not received within 10 seconds of the tab reaching `status: complete` → mark that agent as `error: content_script_timeout` and continue

The `CONTENT_READY` signal replaces any reliance on `status: complete` alone as a "safe to send" trigger.



**Injection process per agent tab:**

1. Content script receives the prompt text from the service worker
2. Content script locates the input element using its selector array (tries each selector in priority order until one matches)
3. If no selector matches → set status to `error: dom_error`, report to panel, stop for this agent
4. Content script injects the prompt text into the input element using the appropriate method for that app's input type (contenteditable vs controlled textarea)
5. Content script locates the send button using its selector array
6. If send button not found → set status to `error: dom_error`, report to panel, stop for this agent
7. Content script waits for the send button to become enabled. After text injection, React/Vue-based apps update the button's enabled state asynchronously — clicking it before this update is a no-op and the prompt is never sent. The content script polls the send button's `disabled` and `aria-disabled` attributes every 100ms until both are absent. Timeout for this wait: 3 seconds. If the button does not become enabled within 3 seconds → set status to `error: send_button_disabled`, report to panel, stop for this agent.
8. Content script clicks the send button
9. Content script immediately begins watching for completion (Step 6)
10. Status is updated to `waiting` and sent to panel

**The prompt text sent to each agent is the raw user prompt, unmodified.** No prefix or system instructions are added to agent prompts.

---

### Step 6 — Completion detection per agent

Each content script independently watches for its agent to finish responding.

**User interference detection:**
Between injection (Step 5) and completion (this step), the user may interact with an agent tab — typing, clicking, or closing it. The content script watches for the following interference signals:
- The input element gains new text content that was not injected by the extension
- The response container is replaced or cleared (indicating the user started a new conversation)
- The tab is navigated away from the expected domain

If any interference signal is detected → immediately set that agent's status to `error: user_interference`, report to panel, stop watching. The session continues with other agents.

**Three-signal detection (evaluated in priority order):**

**Signal 1 — Stop button disappears**
The app's stop/cancel generation button is present while streaming and removed when done. Content script polls for its absence every 500ms after injection. When it disappears → response is done.

**Signal 2 — App-specific done indicator**
Some apps have a class, attribute, or element that explicitly signals completion. Checked alongside Signal 1.

**Signal 3 — DOM stabilisation fallback**
A MutationObserver watches the response container. This signal has two mandatory preconditions before it can fire — both must be true:
1. At least one mutation has already been observed (i.e. the response has started streaming — at least one character or element has appeared). The observer must not trigger on silence before the response begins; that silence is the LLM "thinking", not "done".
2. The extracted text in the response container is at least 10 characters long. This prevents an empty or near-empty response from being incorrectly treated as complete.

Only after both conditions are met: if no further DOM mutations occur for 2 consecutive seconds → treat as done.

**Timeouts:**
- Per-agent timeout: 45 seconds from injection
- If 45 seconds pass with no completion signal → set status to `timeout`, extract whatever text is currently in the response container (partial response), report to panel, stop watching

**On completion:**
- Before extracting text, scroll the response container to its bottom. Some apps use virtual scrolling and only render the visible portion of long responses into the DOM. Scrolling to the bottom forces all content to render.
- Wait 500ms after scrolling for any re-renders triggered by the scroll to settle.
- Then extract the text content of the last assistant response block.
- Strip UI chrome (copy buttons, action menus, footnotes, etc.) — take only readable prose text.
- Set status to `done`
- Send `{ agentKey, status: 'done', responseText, completedAt }` to service worker

---

### Step 7 — Live panel updates

Throughout Steps 5 and 6, the service worker relays status updates to the panel in real time.

Every status change from any agent triggers a panel update:
- `injecting` → card shows "Injecting prompt…"
- `waiting` → card shows spinner and "Waiting for response…"
- `done` → card shows green indicator and response preview
- `timeout` → card shows warning indicator and "Timed out"
- `error: not_logged_in` → card shows "Not logged in"
- `error: dom_error` → card shows "Could not find input"
- `error: tab_load_timeout` → card shows "Tab failed to load"
- `error: content_script_timeout` → card shows "Extension not ready in tab"
- `error: send_button_disabled` → card shows "Could not send prompt"
- `error: user_interference` → card shows "Session interrupted by user"

Progress bar updates as each agent resolves: `completedCount / totalAgentCount`.

---

### Step 8 — Aggregate and build judge prompt

Triggered once all agents have resolved (all are in status `done`, `timeout`, or `error`).

The service worker builds the structured judge prompt:

```
You are a synthesis judge. The following AI agents have each answered a question independently. 
Your task is to analyse their responses, identify areas of agreement and disagreement, 
and produce a final comprehensive verdict.

---

Original question:
[USER PROMPT]

---

Agent responses:

[For each agent with status 'done':]
### [Agent Name]
[Response text]

[For each agent with status 'timeout':]
### [Agent Name]
[No response — this agent timed out.]

[For each agent with status 'error':]
### [Agent Name]
[No response — this agent encountered an error: [reason].]

---

Your task:
1. Identify what all agents agree on
2. Highlight where they diverge and explain why the divergence matters
3. Produce a final verdict that covers all significant angles
4. Flag any blind spots, missing considerations, or caveats none of the agents addressed
```

**Edge case — all agents failed:**
If every agent is in `timeout` or `error` status, the judge prompt is not injected. The session is saved with `status: partial_failure`. The panel shows "All agents failed — no judge prompt sent." The panel returns to State 1 after 3 seconds. No judge tab interaction occurs.

**Edge case — only one agent succeeded:**
The judge prompt is still sent. The judge receives one response and is asked to evaluate it, identify blind spots, and produce a final verdict. This is valid — the judge adds value even over a single response.

**Judge prompt size cap and trimming:**
Before injection, the assembled judge prompt is measured by character count. If the total exceeds 15,000 characters (a safe threshold for all supported judge apps' input fields), the agent response texts are trimmed in the following order:
1. Identify the longest agent response(s) and trim them from the end to reduce their length proportionally until the total is under the cap.
2. Append a note inside the prompt: `[Note: Some agent responses were trimmed to fit within length limits.]`
3. If trimming alone cannot bring the prompt under 15,000 characters (e.g. an extreme number of agents all gave very long responses), truncate each agent response to a maximum of 2,000 characters each and re-measure.
4. If still over the cap after per-agent truncation, the judge prompt is sent as-is — the chat app will handle or reject it as it sees fit. This is an extreme edge case.

The panel does not warn the user about trimming unless the truncation was severe (i.e. step 3 or 4 was reached). In those cases, show a subtle notice: "Some agent responses were shortened to fit the judge's input."

---

### Step 9 — Judge prompt injection

The judge tab (already open from Step 3) receives the structured judge prompt.

**Injection process:**

1. Service worker confirms judge tab is still open and loaded
   - If judge tab was closed by user → open it again at the app's new-chat URL, wait for load
2. Content script for the judge tab injects the structured judge prompt using the same injection mechanism as agent tabs
3. Content script clicks the judge app's send button
4. Content script does NOT wait for the judge to finish — it only needs to confirm the message was sent
5. "Message sent" is confirmed by: send button click succeeded AND the URL begins to change OR the response container appears in the DOM

---

### Step 10 — Judge chat URL capture

After the judge prompt is sent, the service worker captures the conversation permalink using a `chrome.tabs.onUpdated` listener rather than a polling loop.

**URL capture logic:**
- The service worker registers a `chrome.tabs.onUpdated` listener scoped to the judge tab ID immediately after injection.
- Whenever the judge tab's URL changes and the new URL no longer matches the new-chat URL pattern → that URL is the conversation permalink → capture it and remove the listener.
- Maximum wait: 30 seconds. Apps change the URL only after the first response token appears, which can take 10–15 seconds on slower connections or verbose prompts. 5 seconds (prior spec) is too short.
- If no URL change is detected within 30 seconds → fall back to reading the current tab URL one final time. If it has changed → use it. If it still matches the new-chat URL or is unchanged → store `judgeChatUrl: null`.

**Success:** Permalink captured → store as `judgeChatUrl` in the session record.

**Failure (URL did not change within 30s):**
- Some apps (notably Gemini) may not change the URL at all, or the response was very slow.
- Store `judgeChatUrl: null`.
- The panel history entry for this session will show "Judge URL unavailable".

---

### Step 11 — Session saved to IndexedDB

The service worker writes the complete session record to the `sessions` IndexedDB store.

**Session record contains:**
- `id` — auto-increment primary key
- `timestamp` — Unix ms at time of submission
- `prompt` — the original user prompt
- `agentsUsed` — array of agent keys that were selected
- `judgeApp` — the judge app key
- `judgeChatUrl` — the captured permalink, or null
- `agentResults` — array of objects, one per agent:
  - `agentKey`
  - `status` — final status (done / timeout / error)
  - `responseText` — extracted text, or empty string
  - `errorReason` — if errored, the reason string
  - `startedAt` — Unix ms
  - `completedAt` — Unix ms or null
- `status` — overall session status (done / partial / partial_failure / error)
- `durationMs` — total time from submit to judge handoff

---

### Step 12 — Panel transitions to minimal state

The panel moves to State 3 (minimal / judge handoff).

Displays:
- "Judge is running in [Judge App Name]"
- "Switch to judge tab" button → calls `chrome.tabs.update(judgeTabId, { active: true })`
- "New question" button → resets panel to State 1, clears current session state

The agent response cards remain visible above in a scrollable area.

Session is complete from the extension's perspective. The judge runs naturally in its own tab. The user reads the verdict directly in that tab.

---

## Cancel Flow

If the user clicks Cancel during State 2 (execution):

1. Panel sends cancel message to service worker
2. Service worker sets a cancellation flag
3. Any in-progress agent content scripts are messaged to stop watching (they do not interrupt the chat app itself — the chat app may continue generating, the extension just stops listening)
4. The judge tab, if already opened, is closed
5. A partial session record is saved to IndexedDB with `status: cancelled` and whatever agent results were collected up to that point
6. `judgeChatUrl` is set to null
7. Panel returns to State 1

---

## Error Scenarios Reference

### Per-agent errors

| Error | Cause | Behaviour |
|---|---|---|
| `not_logged_in` | Input element not found after 10s grace period, URL matches login page | Skip agent, show on card, continue |
| `tab_load_timeout` | Tab took >15s to reach `status: complete` | Skip agent, show on card, continue |
| `content_script_timeout` | `CONTENT_READY` signal not received within 10s of tab load | Skip agent, show on card, continue |
| `dom_error` | No input/send button selector matched after login grace period | Skip agent, show on card, continue |
| `send_button_disabled` | Send button did not become enabled within 3s of injection | Skip agent, show on card, continue |
| `timeout` | Agent took >45s to respond | Use partial text if any, mark timed out, continue |
| `rate_limited` | App showed rate limit UI | Skip agent, show on card, continue |
| `captcha` | App showed CAPTCHA | Skip agent, show on card, continue |
| `user_interference` | User interaction detected during agent session | Skip agent, show on card, continue |

All per-agent errors are non-fatal. The session continues with whichever agents succeeded.

### Judge errors

| Error | Cause | Behaviour |
|---|---|---|
| `judge_tab_failed` | Judge tab failed to load | Session ends, panel shows error, no judge run |
| `judge_not_logged_in` | Not logged in to judge app | Session ends, panel shows error, no judge run |
| `judge_dom_error` | Judge input element not found | Session ends, panel shows error, judge chat URL null |
| `judge_url_not_captured` | URL didn't change within 30s (via `tabs.onUpdated`) | Judge ran fine, URL stored as null, history entry dimmed |

### Session-level errors

| Status | Meaning |
|---|---|
| `done` | At least one agent succeeded, judge prompt sent, URL captured |
| `partial` | At least one agent succeeded, judge prompt sent, URL may be null |
| `partial_failure` | All agents failed, judge prompt not sent |
| `cancelled` | User cancelled mid-session |
| `error` | Judge tab failed — session could not complete |

---

## History Tab Workflow

### Viewing history

- Sessions are listed in reverse chronological order (newest first)
- Each row shows: prompt preview, date/time, agent count, judge app
- Rows with `judgeChatUrl: null` are visually dimmed and non-tappable
- Rows with a valid `judgeChatUrl` open that URL in a new tab on tap

### Clearing history

- A "Clear all history" action in panel settings
- Prompts confirmation ("Delete all X sessions?")
- On confirm: clears the entire `sessions` IndexedDB store
- History tab immediately shows empty state

### Storage limits

- No hard cap on session count — IndexedDB storage is managed by Chrome's quota
- If storage quota is approached (detectable via `navigator.storage.estimate()`), show a warning in the history tab: "Storage is nearly full. Consider clearing old sessions."
- Sessions are never auto-deleted — user controls this entirely

---

## Configuration — Agents and Judge

### Selecting agents

- Default selection: all supported apps are checked by default on first install
- User can uncheck any app
- Preference is saved to `chrome.storage.sync` and persisted across sessions
- Minimum one agent must remain checked to submit

### Selecting a judge

- Default judge: the first app in the list (ChatGPT) on first install
- User selects via dropdown in the panel
- The judge can be any supported app, including one already selected as an agent
- Preference saved to `chrome.storage.sync`

### Selector maintenance

- Each adapter has a built-in priority-ordered array of CSS selectors for input, send button, stop button, and response container
- A remote config JSON can override these selectors without republishing the extension
- The extension fetches the remote config on startup and caches it for 24 hours
- If remote config fetch fails → fall back to built-in selectors silently
- Users can also manually override selectors per app in the extension's settings page (advanced)

---

## Constraints and Boundaries

- **No API usage.** All interactions happen through the frontend UI of each chat app. No API keys, no backend calls from the extension itself.
- **Single-shot conversations.** Each council session is a single prompt → responses → judge cycle. There is no multi-turn conversation mode.
- **No response text stored for the judge.** The judge's response is never captured or stored by the extension. The user reads it directly in the judge's tab.
- **Agent response text is stored locally.** The full extracted response text for each agent is stored in IndexedDB as part of the session record. This stays on the user's device.
- **No cross-device sync.** History is local only. `chrome.storage.sync` only syncs lightweight preferences (which agents are selected, which judge is selected).
- **Tabs remain visible.** Agent and judge tabs are opened as regular visible tabs, not hidden or minimised programmatically.
- **One session at a time.** The extension does not support running multiple concurrent council sessions. The submit button is disabled while a session is in progress.  code handover summary : We are working in this repo:

/home/naim/Docker_Env/Node/Projects/ai_counceling_extension

Project:
AI Council Chrome/Brave extension built with WXT + React + TypeScript + Manifest V3.

Current architecture:
- WXT handles extension build/dev/manifest.
- React side panel is the main UI.
- Background service worker owns council session orchestration.
- `chrome.storage.sync` stores preferences.
- IndexedDB stores session history.
- Current implementation is demo-mode AI Council:
  - User enters prompt.
  - Selects agents and judge.
  - Background simulates agent responses.
  - Builds judge prompt.
  - Opens judge app manually.
  - History is saved locally.

Important files:
- `entrypoints/background.ts`
- `entrypoints/sidepanel/App.tsx`
- `entrypoints/sidepanel/style.css`
- `utils/types.ts`
- `utils/appRegistry.ts`
- `utils/judgePrompt.ts`
- `utils/history.ts`
- `utils/preferences.ts`
- `wxt.config.ts`
- `README.md`

OpenSpec status:
Previous completed proposals are archived:
- `openspec/changes/archive/2026-06-29-setup-chrome-extension-hello-world`
- `openspec/changes/archive/2026-06-29-add-ai-council-workflow-foundation`

Current active proposal:
`openspec/changes/add-chatgpt-deepseek-automation-foundation`

This proposal has been validated with:
`openspec validate add-chatgpt-deepseek-automation-foundation`

Current next phase scope:
- One agent only: ChatGPT
- One judge only: DeepSeek
- No multi-agent/multi-judge support in this phase
- User will provide real DOM selectors after inspecting ChatGPT and DeepSeek pages
- DOM selectors must live in separate editable JSON files, not hard-coded in TypeScript
- The extension should automate:
  1. Send user prompt to ChatGPT
  2. Extract ChatGPT response
  3. Build judge prompt
  4. Send judge prompt to DeepSeek
  5. Extract DeepSeek judge response
  6. Show final judge response in side panel
  7. Save result in local history

Current active proposal files to read first:
- `openspec/changes/add-chatgpt-deepseek-automation-foundation/proposal.md`
- `openspec/changes/add-chatgpt-deepseek-automation-foundation/design.md`
- `openspec/changes/add-chatgpt-deepseek-automation-foundation/tasks.md`

Key implementation rule:
Use OpenSpec apply workflow. Implement step by step from `tasks.md`, pausing after each numbered section for manual user testing.

Recommended first implementation step:
Start with task group 1:
- Add shared automation types.
- Add selector config TypeScript types.
- Add editable JSON selector config files for ChatGPT and DeepSeek.
- Add selector config loading/validation helpers.
- Update app registry so ChatGPT is fixed agent and DeepSeek is fixed judge.
- Do not yet automate DOM submission.

Dev commands:
- `npm run compile`
- `npm run build`
- `npm run dev:brave`
- `npm run dev:manual`

Flatpak Brave setup already exists:
- `scripts/brave-flatpak`
- `scripts/chrome-flatpak`

Manual dev loading:
Load `.output/chrome-mv3-dev` as unpacked extension, not `.output` and not the zip.

Important constraints:
- Use TypeScript, not JS.
- Keep selectors editable in JSON.
- Keep implementation simple and stepwise.
- Do not add host permissions for all AI apps yet.
- Only ChatGPT and DeepSeek host permissions should be added for this phase. . check the current active spec that we have to complete by implementing it . 

---

## Assistant (Build · DeepSeek V4 Pro · 132.4s)

_Thinking:_

Let me start by understanding the current state of the project. I need to read the active proposal files and the current codebase to understand what needs to be implemented.

**Tool: read**

**Input:**
```json
{
  "filePath": "/home/naim/Docker_Env/Node/Projects/ai_counceling_extension/openspec/changes/add-chatgpt-deepseek-automation-foundation/proposal.md"
}
```

**Output:**
```
<path>/home/naim/Docker_Env/Node/Projects/ai_counceling_extension/openspec/changes/add-chatgpt-deepseek-automation-foundation/proposal.md</path>
<type>file</type>
<content>
1: ## Why
2: 
3: AI Council is ready for its first real browser automation slice, but the next step should stay intentionally small. This phase will prove the workflow with exactly one agent and one judge: ChatGPT as the agent, DeepSeek as the judge, and editable JSON selector config so DOM details can be updated without changing TypeScript code.
4: 
5: ## What Changes
6: 
7: - Restrict this implementation phase to a fixed workflow: one ChatGPT agent and one DeepSeek judge.
8: - Add a reusable browser automation boundary between the background orchestrator and app-specific content scripts.
9: - Add ChatGPT prompt submission, response waiting, response extraction, timeout handling, and cancellation behavior for the agent step.
10: - Add DeepSeek judge prompt submission, response waiting, response extraction, timeout handling, and cancellation behavior for the judge step.
11: - Store app DOM selectors and related DOM lookup values in separate JSON config files so the user can update them after inspecting the real pages.
12: - Add narrow host permissions and content-script registration for ChatGPT and DeepSeek only.
13: - Update the side panel so this phase presents the fixed ChatGPT-to-DeepSeek flow instead of the full multi-agent/multi-judge selector workflow.
14: - Save the ChatGPT agent response and DeepSeek judge response in local history for this fixed workflow.
15: - Defer Claude, Gemini, Qwen, Kimi, multi-agent selection, multi-judge selection, remote selector config, selector editing UI, and all other app adapters to later changes.
16: 
17: ## Capabilities
18: 
19: ### New Capabilities
20: 
21: - `ai-council-real-agent-automation`: Browser-tab automation for a fixed ChatGPT agent run, including tab lifecycle, content-script readiness, prompt send, response extraction, timeouts, and cancellation.
22: - `ai-council-chatgpt-adapter`: ChatGPT-specific content-script adapter behavior for detecting usable chat UI, sending the user prompt, waiting for completion, and extracting the final assistant response.
23: - `ai-council-deepseek-judge-adapter`: DeepSeek-specific content-script adapter behavior for receiving the generated judge prompt, submitting it, waiting for completion, and extracting the final judge response.
24: - `ai-council-selector-config`: JSON-backed selector configuration for ChatGPT and DeepSeek DOM values used by content-script adapters.
25: 
26: ### Modified Capabilities
27: 
28: - `ai-council-orchestration`: Replace pure demo execution with a fixed real automation pipeline: user prompt -> ChatGPT agent -> judge prompt builder -> DeepSeek judge.
29: - `ai-council-app-registry`: Mark ChatGPT as the only agent automation target and DeepSeek as the only judge automation target for this phase.
30: - `ai-council-side-panel`: Replace broad app selection in this phase with a simple fixed-flow UI that clearly shows ChatGPT as agent and DeepSeek as judge.
31: - `ai-council-storage`: Store the DeepSeek judge response for fixed-flow sessions in addition to the ChatGPT agent response.
32: - `chrome-extension-foundation`: Add the minimal host permissions and content-script manifest behavior needed for ChatGPT and DeepSeek automation.
33: 
34: ## Impact
35: 
36: - Affects WXT entrypoints by adding content scripts for ChatGPT and DeepSeek pages.
37: - Affects `entrypoints/background.ts` by introducing a real automation pipeline alongside or in place of the current demo runner for this phase.
38: - Affects shared TypeScript contracts for automation commands, content-script events, selector config, agent execution, judge execution, and error reasons.
39: - Affects `wxt.config.ts` by adding narrow ChatGPT and DeepSeek host permissions and content-script registration.
40: - Affects the side panel UI by simplifying the current full app selector into a fixed ChatGPT-agent and DeepSeek-judge workflow for this implementation round.
41: - Affects IndexedDB history shape by storing the judge response text for this fixed-flow phase.
42: - Requires manual browser verification in Brave/Chrome with logged-in ChatGPT and DeepSeek sessions.

(End of file - total 42 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/home/naim/Docker_Env/Node/Projects/ai_counceling_extension/openspec/changes/add-chatgpt-deepseek-automation-foundation/design.md"
}
```

**Output:**
```
<path>/home/naim/Docker_Env/Node/Projects/ai_counceling_extension/openspec/changes/add-chatgpt-deepseek-automation-foundation/design.md</path>
<type>file</type>
<content>
1: ## Context
2: 
3: The current extension has a working WXT, React, TypeScript, and Manifest V3 side-panel foundation. The side panel sends typed messages to `entrypoints/background.ts`, the background owns one active council session, and the first AI Council round uses demo timers to simulate selected agents.
4: 
5: The previous proposal scoped the next phase to ChatGPT real-agent automation while keeping other apps in fallback/demo mode. The scope is now tighter and more concrete: exactly one agent and one judge. ChatGPT will answer the user's original prompt, then DeepSeek will judge the generated answer from a structured judge prompt.
6: 
7: Target shape for this change:
8: 
9: ```text
10: Side Panel
11:     |
12:     v
13: Background Orchestrator
14:     |
15:     +--> ChatGPT Agent Runner
16:     |       open ChatGPT tab
17:     |       load chatgpt selectors JSON
18:     |       submit user prompt
19:     |       extract agent response
20:     |
21:     +--> Judge Prompt Builder
22:     |
23:     +--> DeepSeek Judge Runner
24:             open DeepSeek tab
25:             load deepseek selectors JSON
26:             submit judge prompt
27:             extract judge response
28: ```
29: 
30: Selector ownership:
31: 
32: ```text
33: config/selectors/chatgpt.json
34:     input selectors
35:     send selectors
36:     response selectors
37:     completion selectors
38: 
39: config/selectors/deepseek.json
40:     input selectors
41:     send selectors
42:     response selectors
43:     completion selectors
44: ```
45: 
46: The JSON files are intentionally part of the repo so the user can update selector values after inspecting the actual DOM. TypeScript owns behavior and validation; JSON owns site-specific DOM values.
47: 
48: ## Goals / Non-Goals
49: 
50: **Goals:**
51: 
52: - Implement only the fixed ChatGPT-agent -> DeepSeek-judge flow.
53: - Register ChatGPT and DeepSeek content scripts using WXT and narrow host permissions.
54: - Load adapter selector values from separate JSON files instead of hard-coding DOM selectors in TypeScript.
55: - Add background tab runners that can open ChatGPT and DeepSeek, wait for content-script readiness, send prompts, receive results, timeout, and cancel.
56: - Add a ChatGPT adapter that submits the user prompt and extracts the final assistant response.
57: - Add a DeepSeek adapter that submits the generated judge prompt and extracts the final judge response.
58: - Simplify the side panel for this phase so the user sees the fixed agent/judge pair clearly.
59: - Persist the original prompt, ChatGPT response, DeepSeek judge response, status, duration, and relevant URLs in local history.
60: - Keep implementation steps separated so the user can test each phase before continuing.
61: 
62: **Non-Goals:**
63: 
64: - Multiple agents.
65: - User-selectable judges.
66: - Real automation for Claude, Gemini, Qwen, or Kimi.
67: - A selector editing UI inside the extension.
68: - Remote selector configuration.
69: - CAPTCHA solving, login bypassing, or actions that work around site access restrictions.
70: - Multi-session concurrency.
71: 
72: ## Decisions
73: 
74: ### Use A Fixed ChatGPT-To-DeepSeek Workflow
75: 
76: The UI and orchestrator should stop pretending this phase supports all app combinations. Fixed scope makes testing easier: one prompt goes to ChatGPT, one judge prompt goes to DeepSeek, then the session completes.
77: 
78: Alternative considered: keep the previous broad agent/judge selectors and only automate one pair. That keeps the old UI, but it creates confusing behavior when users select unsupported apps.
79: 
80: ### Store Selectors In JSON
81: 
82: Adapters will read selector config from JSON files such as `config/selectors/chatgpt.json` and `config/selectors/deepseek.json`. Each file should include ordered selector arrays for input, send button, response containers, completion indicators, and optional blocked/login/error signals.
83: 
84: Alternative considered: hard-code selectors in adapter TypeScript. That is faster initially, but it makes every DOM tweak a code edit instead of a small data update.
85: 
86: ### Keep Adapter Logic Typed And Shared
87: 
88: ChatGPT and DeepSeek need different selector JSON, but they can share content-script helper behavior: query ordered selectors, wait for an element, set input text, trigger send, wait for stable response text, and return normalized results.
89: 
90: Alternative considered: write two completely separate adapters. That is simple at first but duplicates timeout, extraction, and error handling.
91: 
92: ### Automate The Judge In This Phase
93: 
94: DeepSeek should receive the generated judge prompt automatically and return a final judge response to the extension. This turns the phase into a complete fixed workflow rather than stopping at manual judge handoff.
95: 
96: Alternative considered: open DeepSeek with manual handoff only. That avoids a second adapter, but it does not test the full council workflow.
97: 
98: ### Use Narrow Host Permissions
99: 
100: The manifest should include ChatGPT and DeepSeek host permissions only. Other supported app host permissions should remain absent until their adapters exist.
101: 
102: Alternative considered: add all future app host permissions now. That is broader than needed and makes permission prompts noisier.
103: 
104: ## Risks / Trade-offs
105: 
106: - ChatGPT or DeepSeek DOM changes can break selectors -> keep selectors in JSON and fail with readable adapter errors.
107: - User-provided selectors may be incomplete at first -> validate selector config shape and report missing selector groups clearly.
108: - User may not be logged in -> detect missing inputs or blocked states and return `not_logged_in` or `dom_error` rather than waiting forever.
109: - DeepSeek response extraction may differ from ChatGPT -> share the generic helper but keep app-specific selector files separate.
110: - Manifest host permissions increase scope -> add only ChatGPT and DeepSeek patterns for this round.
111: - MV3 service worker can suspend -> keep this first real workflow as one active in-memory session and persist completed records.
112: 
113: ## Migration Plan
114: 
115: 1. Add selector JSON schema/types and placeholder selector JSON files for ChatGPT and DeepSeek.
116: 2. Add shared automation command/result contracts for agent and judge runs.
117: 3. Register ChatGPT and DeepSeek content scripts with narrow host permissions.
118: 4. Add readiness checks that load and validate selector config without submitting prompts.
119: 5. Add the background fixed-flow runner for ChatGPT -> judge prompt -> DeepSeek.
120: 6. Implement ChatGPT prompt submission and extraction using `chatgpt.json`.
121: 7. Implement DeepSeek judge prompt submission and extraction using `deepseek.json`.
122: 8. Simplify side panel controls for the fixed pair.
123: 9. Persist judge response in history and update documentation.
124: 10. Verify compile/build and manual Brave/Chrome behavior with logged-in ChatGPT and DeepSeek sessions.
125: 
126: Rollback is straightforward: disable the fixed real automation runner and return the side panel to the previous demo behavior, then remove the ChatGPT/DeepSeek content-script registration if needed.
127: 
128: ## Open Questions
129: 
130: - Should selector JSON live under `config/selectors/` or closer to content scripts under `utils/automation/selectors/`?
131: - Should the placeholder selector JSON start mostly empty for the user to fill, or include best-effort defaults that the user can replace?
132: - Should ChatGPT and DeepSeek automation tabs stay open after completion for inspection, or should the extension focus back to the side panel/result state?

(End of file - total 132 lines)
</content>
```

**Tool: read**

**Input:**
```json
{
  "filePath": "/home/naim/Docker_Env/Node/Projects/ai_counceling_extension/openspec/changes/add-chatgpt-deepseek-automation-foundation/tasks.md"
}
```

**Output:**
```
<path>/home/naim/Docker_Env/Node/Projects/ai_counceling_extension/openspec/changes/add-chatgpt-deepseek-automation-foundation/tasks.md</path>
<type>file</type>
<content>
1: ## 1. Fixed Scope And Selector Config
2: 
3: - [ ] 1.1 Add shared automation types for fixed ChatGPT-agent and DeepSeek-judge commands, readiness responses, adapter results, timeouts, and execution modes
4: - [ ] 1.2 Add selector config TypeScript types for ordered input, send, response, completion, blocked/login, and error selector groups
5: - [ ] 1.3 Add editable JSON selector config files for ChatGPT and DeepSeek with documented placeholder keys
6: - [ ] 1.4 Add selector config loading and validation helpers that produce readable errors for missing selector groups
7: - [ ] 1.5 Update the app registry so ChatGPT is the only automation-supported agent and DeepSeek is the only automation-supported judge for this phase
8: - [ ] 1.6 Stop for user review so selector JSON shape can be checked before manifest/content-script wiring
9: 
10: ## 2. Manifest And Content Script Shells
11: 
12: - [ ] 2.1 Add ChatGPT host permissions for `https://chat.openai.com/*` and `https://chatgpt.com/*`
13: - [ ] 2.2 Add DeepSeek host permissions for `https://chat.deepseek.com/*`
14: - [ ] 2.3 Add WXT content-script entrypoints for ChatGPT and DeepSeek with no real DOM submission yet
15: - [ ] 2.4 Add a typed runtime message bridge between the background service worker and each content script
16: - [ ] 2.5 Run compile/build and verify the generated manifest contains only ChatGPT and DeepSeek host permissions and content-script match patterns
17: - [ ] 2.6 Stop for user review before adding readiness behavior
18: 
19: ## 3. Readiness And Diagnostics
20: 
21: - [ ] 3.1 Implement ChatGPT readiness detection using `chatgpt.json` selector config
22: - [ ] 3.2 Implement DeepSeek readiness detection using `deepseek.json` selector config
23: - [ ] 3.3 Return clear readiness failures for missing config, missing input, likely login state, unexpected DOM state, and timeout
24: - [ ] 3.4 Add background diagnostic helpers that can open ChatGPT and DeepSeek and confirm content-script handshakes without submitting prompts
25: - [ ] 3.5 Run compile/build and manually verify readiness in Brave with logged-in ChatGPT and DeepSeek tabs
26: - [ ] 3.6 Stop for user review so the user can update selector JSON from actual DOM inspection
27: 
28: ## 4. Background Fixed Workflow Runner
29: 
30: - [ ] 4.1 Add a fixed workflow runner that opens ChatGPT, waits for readiness, runs the agent prompt, and captures the ChatGPT response
31: - [ ] 4.2 Feed the ChatGPT response into the existing judge prompt builder
32: - [ ] 4.3 Open DeepSeek, wait for readiness, submit the judge prompt, and capture the DeepSeek judge response
33: - [ ] 4.4 Add bounded timeout handling for tab load, content-script readiness, prompt send, response wait, and extraction for both apps
34: - [ ] 4.5 Add cancellation cleanup for pending timers, tab listeners, ChatGPT work, DeepSeek work, and unresolved session results
35: - [ ] 4.6 Broadcast fixed-workflow status updates through the existing `CouncilSnapshot` model
36: - [ ] 4.7 Stop for user review before real DOM submission/extraction is enabled
37: 
38: ## 5. ChatGPT Agent Adapter
39: 
40: - [ ] 5.1 Implement ChatGPT prompt injection using selectors from `chatgpt.json`
41: - [ ] 5.2 Implement ChatGPT send triggering with disabled-send handling
42: - [ ] 5.3 Implement ChatGPT response wait logic that detects generation completion or stable final response text
43: - [ ] 5.4 Implement ChatGPT latest assistant response extraction with empty-response and DOM-error handling
44: - [ ] 5.5 Normalize ChatGPT success, timeout, and error outcomes into the existing agent result model
45: - [ ] 5.6 Run compile/build and manually verify ChatGPT can receive a prompt and return extracted response text
46: - [ ] 5.7 Stop for user review before enabling DeepSeek judge submission
47: 
48: ## 6. DeepSeek Judge Adapter
49: 
50: - [ ] 6.1 Implement DeepSeek judge prompt injection using selectors from `deepseek.json`
51: - [ ] 6.2 Implement DeepSeek send triggering with disabled-send handling
52: - [ ] 6.3 Implement DeepSeek response wait logic that detects generation completion or stable final response text
53: - [ ] 6.4 Implement DeepSeek latest judge response extraction with empty-response and DOM-error handling
54: - [ ] 6.5 Normalize DeepSeek success, timeout, and error outcomes into the session result model
55: - [ ] 6.6 Run compile/build and manually verify DeepSeek can receive the generated judge prompt and return extracted judge response text
56: - [ ] 6.7 Stop for user review before UI/history polish
57: 
58: ## 7. Side Panel And History
59: 
60: - [ ] 7.1 Simplify the Council tab to show fixed ChatGPT agent and DeepSeek judge instead of multi-agent and judge selectors
61: - [ ] 7.2 Update running state labels so the user can see ChatGPT agent progress and DeepSeek judge progress separately
62: - [ ] 7.3 Show the final DeepSeek judge response in the side panel after workflow completion
63: - [ ] 7.4 Store the DeepSeek judge response and relevant ChatGPT/DeepSeek URLs in IndexedDB history
64: - [ ] 7.5 Update history rows so fixed-flow sessions can reopen the relevant judge URL and show completion status clearly
65: - [ ] 7.6 Run manual end-to-end tests for success, cancellation, ChatGPT timeout/error, DeepSeek timeout/error, final judge display, and history rows
66: - [ ] 7.7 Stop for user approval before considering more agents or judges
67: 
68: ## 8. Documentation And Final Verification
69: 
70: - [ ] 8.1 Update README with the fixed ChatGPT-agent to DeepSeek-judge dev/test flow
71: - [ ] 8.2 Document the selector JSON files, expected selector groups, and how the user can update DOM values
72: - [ ] 8.3 Document required logged-in state for ChatGPT and DeepSeek and known limitations
73: - [ ] 8.4 Run TypeScript compile checks
74: - [ ] 8.5 Run production build
75: - [ ] 8.6 Inspect generated manifest for MV3, side panel, storage/tabs permissions, ChatGPT/DeepSeek host permissions, and only ChatGPT/DeepSeek content scripts
76: - [ ] 8.7 Run Brave/Chrome manual verification and record selector issues discovered during testing

(End of file - total 76 lines)
</content>
```

---

## Assistant (Build · DeepSeek V4 Pro)

_Thinking:_

Now let me read the current codebase to understand the existing architecture before starting implementation.

Now let me read the existing codebase to understand the current architecture

**Tool: task**

**Input:**
```json
{
  "description": "Explore current codebase",
  "subagent_type": "explore",
  "prompt": "Very thoroughly explore the codebase at /home/naim/Docker_Env/Node/Projects/ai_counceling_extension. I need to understand:\n\n1. The full directory structure (all files, not just top-level)\n2. The contents of all source files including:\n   - entrypoints/background.ts\n   - entrypoints/sidepanel/App.tsx\n   - entrypoints/sidepanel/style.css\n   - utils/types.ts\n   - utils/appRegistry.ts\n   - utils/judgePrompt.ts\n   - utils/history.ts\n   - utils/preferences.ts\n   - wxt.config.ts\n   - package.json\n   - tsconfig.json\n   - Any content script files\n   - Any manifest files\n3. Read the openspec/ directory structure fully\n\nReturn ALL file contents in full, not summaries. This is critical for understanding the current state."
}
```

---

