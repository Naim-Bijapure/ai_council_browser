## Why

AI Council needs a clear product architecture before adding fragile browser automation against multiple third-party chat UIs. A staged foundation lets us build and test the side panel, orchestration state, storage, and message contracts first, then add real per-app tab automation in controlled follow-up rounds.

## What Changes

- Add the AI Council side panel as the primary extension UI with Council and History tabs.
- Define supported chat apps as configurable agent and judge targets.
- Introduce a single-session council workflow with prompt validation, selected agents, selected judge, live status cards, cancellation, and a judge handoff state.
- Add a background orchestration layer that owns session state and communicates with the side panel.
- Add local persistence boundaries: `chrome.storage.sync` for lightweight preferences and IndexedDB for session history.
- Add shared TypeScript models and message contracts so future content scripts can plug into the same workflow.
- Scope the first implementation round to a local/demo execution mode that simulates agent completion and judge handoff without automating external chat apps yet.
- Defer real chat-app content scripts, selector maintenance, login detection, response extraction, remote selector config, and judge URL capture to later implementation rounds.

## Capabilities

### New Capabilities

- `ai-council-side-panel`: Side panel UI for entering prompts, selecting agents, choosing a judge, viewing live run status, cancelling, seeing judge handoff, and browsing history.
- `ai-council-orchestration`: Background service worker workflow for validating requests, tracking one active session, relaying status updates, producing judge prompt payloads, and handling cancellation.
- `ai-council-storage`: Local persistence for user preferences and session history using `chrome.storage.sync` and IndexedDB.
- `ai-council-app-registry`: Supported app registry for ChatGPT, Claude, Gemini, DeepSeek, Qwen, and Kimi with app keys, display names, domains, and new-chat URLs.

### Modified Capabilities

- None.

## Impact

- Affects the WXT Manifest V3 extension structure, especially side panel configuration, background service worker code, and shared TypeScript modules.
- Replaces the current hello-world popup-first experience with an AI Council side panel workflow while keeping the extension minimal and testable.
- Adds IndexedDB usage in extension contexts and `chrome.storage.sync` preference handling.
- Requires Chrome extension permissions for side panel, tabs, storage, and supported app host patterns when real tab automation begins; Round 1 should keep external automation inactive unless explicitly implemented.
- Establishes contracts for later content scripts and app adapters without depending on brittle selectors in the first round.
