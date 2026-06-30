## Context

The AI Council extension automates LLM chat websites by injecting prompts into their input elements and extracting responses. The injection code in `adapterHelpers.ts` uses the React-native value setter trick (`HTMLTextAreaElement.prototype.value` setter + `InputEvent`) which works for DeepSeek but fails for Qwen (Antd `Input.TextArea`). The root cause is React's `_valueTracker` optimization: when a programmatic value change matches the tracked value, React suppresses the synthetic `onChange` event, so the framework's state never updates, the send button never renders, and the automation times out.

Additionally, the existing `DIAGNOSTIC_CHECK` only verifies that the `input` selector matches an element on the page. It does not test injection, send button rendering, response detection, or text extraction. When a new LLM is added, the only way to verify selectors is to run a full council session — slow, noisy, and hard to debug.

## Goals / Non-Goals

**Goals:**
- Fix text injection for React-controlled inputs (Antd, React hooks) so all current and future LLMs receive injected text.
- Build a selector probe tool that verifies selector configs in seconds without running a full council.
- Static probe: verify each selector field matches the correct element on a new-chat page.
- Live probe: inject a test prompt, verify send button enables, click send, wait for response, extract preview.
- Probe tool is 100% data-driven by selector JSON — no app-specific code.
- Probe tab stays open after live test for manual DOM inspection.

**Non-Goals:**
- Changing the council runner flow (agent tab activation, judge URL capture — already fixed).
- Auto-closing probe tabs.
- Replacing the existing diagnostics button.
- Adding new LLM apps (only fixing injection + building the verification tool).

## Decisions

### 1. Reset `_valueTracker` before dispatching `input` event

- **Decision**: In `setInputText`, before dispatching `InputEvent("input")`, call `delete (element as any)._valueTracker` for textarea and input elements.
- **Rationale**: React attaches a `_valueTracker` property to controlled inputs. When `input` event fires, React compares the tracked value with the current DOM value. If they match (because we set the value programmatically), React suppresses `onChange`. Deleting the tracker forces React to treat the value as changed and fire `onChange`, updating the component's state.
- **Alternative considered**: Walk React fiber tree (`__reactProps$`) and call `onChange` directly. Rejected as too fragile — React internal structure varies across versions and is not part of the public API.
- **Alternative considered**: Use `document.execCommand("insertText")` with focus. Rejected because it only works in foreground tabs; background agent tabs would still fail.
- **Safety**: `_valueTracker` only exists on React-controlled inputs. `delete` on a non-existent property is a no-op. DeepSeek already works — the reset ensures `onChange` fires (which it already did), so no behavior change. ChatGPT uses contenteditable (different code branch), not affected.

### 2. Enter-key fallback when send button not found

- **Decision**: If `waitForSendButtonEnabled` returns null or a disabled button after 5 seconds, dispatch an Enter key sequence (`keydown` → `keypress` → `keyup`) on the input element.
- **Rationale**: Some apps (Antd `onPressEnter`, React `onKeyDown`) submit on Enter. This is a universal fallback that works regardless of send button DOM structure.
- **Safety**: Only fires in the error path (send button not found), which was always a failure before. Cannot affect working apps.

### 3. Probe tool uses existing tab + content script infrastructure

- **Decision**: The probe reuses `openTabAndListenForReady` to open a tab and wait for content-script readiness, then sends a `PROBE_RUN` message. The content script runs the probe logic and returns `PROBE_RESULT`.
- **Rationale**: No new infrastructure needed. The content-script bridge, message routing, and tab lifecycle are already in place.
- **Alternative considered**: Run probe logic entirely in the background script via `chrome.scripting.executeScript`. Rejected because it bypasses the content script's React fiber access and framework-specific logic.

### 4. Two probe modes: static and live

- **Decision**: Static mode checks each selector field against the DOM (no injection, no sending). Live mode runs the full flow: inject → send → wait → extract.
- **Rationale**: Static is fast (~2s) and safe (no message sent). Live is thorough (~30s) but sends a real test message. Users can verify selectors quickly with static, then confirm end-to-end with live.
- **Alternative considered**: Single mode that always sends. Rejected because sending test messages to production LLMs is wasteful when only verifying selector syntax.

### 5. Probe results as a step-by-step checklist

- **Decision**: `ProbeResult` contains an array of `ProbeStep` objects, each with `field`, `status` (pass/fail/warn/skip), `detail`, and `matchedSelector`. The sidepanel renders this as a checklist.
- **Rationale**: Per-step reporting pinpoints exactly which selector is wrong, rather than a single pass/fail. Users can iterate: fix JSON → re-probe → see which step now passes.
- **Step list for static mode**: `input`, `send` (with disabled warning), `response` (skip on new chat), `completion` (skip on new chat), `blocked`, `loginError`.
- **Step list for live mode**: all static steps + `injection` (text landed?), `send` (enabled after injection?), `send_click` (clicked or Enter fallback?), `response_wait` (response appeared + completed?), `response_preview` (first 100 chars of extracted text).

### 6. Probe panel coexists with existing diagnostics

- **Decision**: Keep the existing "Run diagnostics" button as-is. Add the probe panel below it with an app dropdown, static/live buttons, and results checklist.
- **Rationale**: Diagnostics is a quick readiness check (is the user logged in?). Probe is a thorough selector verification. Different purposes, both useful.

## Risks / Trade-offs

- **[Risk] `_valueTracker` deletion might not work for all React versions** → *Mitigation*: The technique is used by Cypress, Playwright, and React Testing Library. It has been stable since React 16. If a future React version changes this, the Enter-key fallback provides a secondary path.
- **[Risk] Live probe sends a real message to the LLM** → *Mitigation*: Test prompt is "Say hello" — minimal token usage. User explicitly clicks "Live Probe" so it's intentional. Tab stays open so user can delete the conversation.
- **[Risk] Probe adds complexity to the message protocol** → *Mitigation*: New message types are additive. Existing `AGENT_RUN`, `JUDGE_RUN`, `DIAGNOSTIC_CHECK` flows are unchanged. Content bridge handler is a new `case` in the switch, not a modification of existing handlers.
- **[Risk] Probe UI clutter in sidepanel** → *Mitigation*: Probe panel is collapsible and placed below diagnostics. Default state is collapsed.
