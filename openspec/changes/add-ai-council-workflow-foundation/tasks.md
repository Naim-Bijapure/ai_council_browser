## 1. Shared Foundation

- [x] 1.1 Add shared TypeScript domain models for app keys, preferences, messages, session state, agent results, and stored session records
- [x] 1.2 Add a supported app registry for ChatGPT, Claude, Gemini, DeepSeek, Qwen, and Kimi
- [x] 1.3 Add judge prompt builder utilities with handling for done, timeout, and error agent results
- [x] 1.4 Add small formatting helpers for prompt previews, timestamps, status labels, and character counts

## 2. Storage Layer

- [x] 2.1 Add `chrome.storage.sync` preference helpers for selected agents and selected judge
- [x] 2.2 Add IndexedDB session history helpers for creating, listing, and clearing sessions
- [x] 2.3 Add default preference initialization using all supported apps as agents and ChatGPT as judge
- [x] 2.4 Verify storage helpers handle empty history and missing preferences cleanly

## 3. Side Panel UI

- [x] 3.1 Configure WXT Manifest V3 side panel support and extension action behavior
- [x] 3.2 Create the React side panel entrypoint with Council and History tabs
- [x] 3.3 Build the Council input state with prompt textarea, character counter, agent checkboxes, judge dropdown, validation errors, and Run council button
- [x] 3.4 Build the running state with locked input, progress indicator, per-agent status cards, response previews, and Cancel button
- [x] 3.5 Build the judge handoff state with selected judge name, Switch to judge tab action, New question action, and resolved agent cards
- [x] 3.6 Build the History tab with newest-first session rows, dimmed missing-URL rows, empty state, and clear-history confirmation
- [x] 3.7 Style the side panel for compact extension use without landing-page or marketing layout patterns

## 4. Background Orchestration Demo Mode

- [x] 4.1 Replace the hello-world background behavior with a typed message router for side panel requests
- [x] 4.2 Implement run request validation for empty prompt, missing agents, missing judge, and prompt length over 10000 characters
- [x] 4.3 Enforce one active council session at a time
- [x] 4.4 Implement demo agent execution that emits `injecting`, `waiting`, and resolved status updates per selected agent
- [x] 4.5 Build the structured judge prompt after agents resolve and enter judge handoff when at least one agent succeeds
- [x] 4.6 Handle all-agents-failed as `partial_failure` without judge handoff
- [x] 4.7 Implement cancellation that stops demo execution, saves a cancelled record, and clears active session state
- [x] 4.8 Broadcast current session snapshots to the side panel on connection and on every state change

## 5. Integration And Verification

- [x] 5.1 Wire the side panel to background messages for loading preferences, starting runs, receiving updates, cancelling, switching judge tab, and history actions
- [x] 5.2 Run TypeScript compile checks and production build
- [ ] 5.3 Run the extension in Brave/Chrome dev mode and manually test input validation, demo run progress, cancellation, judge handoff, history rows, and clear history
- [x] 5.4 Update README with the AI Council side panel dev/test flow and note that Round 1 uses demo execution only
- [ ] 5.5 Stop after Round 1 verification and wait for user approval before proposing real chat-app automation
