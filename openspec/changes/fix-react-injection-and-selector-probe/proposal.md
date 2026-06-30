## Why

Text injection into React-controlled textareas (Antd `Input.TextArea`) silently fails because React's `_valueTracker` optimization swallows synthetic `input` events when the DOM value was changed programmatically. This prevents Qwen (and likely Claude, Gemini, Kimi) from detecting injected text, so the send button never renders and the automation times out. Additionally, there is no way to verify selector accuracy without running a full council session — the existing diagnostic only checks if the input selector matches, not whether injection, send, or response extraction actually work.

## What Changes

- Reset React's `_valueTracker` before dispatching `input` events in `setInputText`, so React-controlled components (Antd, React hooks) receive the `onChange` callback and update their internal state.
- Add a selector probe tool with two modes: **static** (verify each selector matches the right element on a new-chat page) and **live** (inject a test prompt, verify send button enables, click send, wait for response, extract preview text).
- Add new message types `PROBE_RUN` (background → content) and `PROBE_RESULT` (content → background) to the automation message protocol.
- Add a probe panel in the sidepanel with an app selector dropdown, static/live buttons, and a per-step results checklist.
- The probe tool is fully data-driven by selector JSON — no app-specific code, works for any current or future LLM.

## Capabilities

### New Capabilities

- `ai-council-selector-probe`: Sidepanel tool for verifying selector configs against live LLM websites, with static (selector match) and live (end-to-end injection + response) probe modes.

### Modified Capabilities

- `ai-council-real-agent-automation`: Text injection resets React's `_valueTracker` before dispatching `input` events so React-controlled components update their state. Enter-key fallback added when send button is not found or disabled.

## Impact

- `utils/automation/adapterHelpers.ts` — `setInputText` adds `delete (element as any)._valueTracker` before `InputEvent` dispatch for textarea/input branches. Adds `focus()` before injection.
- `utils/automation/genericAdapter.ts` — `runAgent` and `runJudge` add Enter-key fallback when send button is not found (already partially done).
- `utils/automation/messages.ts` — new `PROBE_RUN` and `PROBE_RESULT` message types.
- `utils/automation/types.ts` — new `ProbeStep`, `ProbeResult`, `ProbeMode` interfaces.
- `utils/automation/probe.ts` — new file: `runProbeStatic()` and `runProbeLive()` functions.
- `utils/automation/contentBridge.ts` — new `PROBE_RUN` handler.
- `entrypoints/background.ts` — new `RUN_PROBE` panel request handler.
- `utils/types.ts` — `RUN_PROBE` added to `PanelRequest`, `ProbeResult` added to `PanelResponse`.
- `entrypoints/sidepanel/App.tsx` — probe panel UI with dropdown, buttons, results.
- `entrypoints/sidepanel/style.css` — probe panel styles.
- No manifest or permissions changes (probe uses existing tab creation + content script messaging).
