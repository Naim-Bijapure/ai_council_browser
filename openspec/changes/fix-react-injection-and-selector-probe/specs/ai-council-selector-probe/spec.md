## ADDED Requirements

### Requirement: Selector Probe Tool
The system SHALL provide a sidepanel tool for verifying selector configurations against live LLM websites without running a full council session.

#### Scenario: Static probe run
- **WHEN** the user selects an app and clicks "Static Probe"
- **THEN** the system opens a tab to the app's new-chat URL, waits for content-script readiness, and evaluates each selector field (`input`, `send`, `response`, `completion`, `blocked`, `loginError`) against the DOM, returning a per-field pass/fail/warn/skip result

#### Scenario: Live probe run
- **WHEN** the user selects an app and clicks "Live Probe"
- **THEN** the system opens a tab, injects a test prompt, verifies the send button enables, submits the prompt, waits for the response to complete, and extracts a text preview — returning a per-step result checklist

#### Scenario: Probe tab stays open
- **WHEN** a probe (static or live) completes
- **THEN** the probe tab SHALL remain open so the user can inspect the DOM manually

#### Scenario: Probe is data-driven
- **WHEN** the probe runs for any app
- **THEN** the probe logic SHALL use only the app's selector JSON configuration — no app-specific code or hardcoded selectors

### Requirement: Probe Result Reporting
The system SHALL report probe results as a list of steps, each with a field name, status, and detail message.

#### Scenario: Pass step
- **WHEN** a selector field matches an element (or an injection/click/response step succeeds)
- **THEN** the step status is `pass` with a detail message identifying the matched selector and element tag

#### Scenario: Fail step
- **WHEN** a selector field does not match any element (or an injection/click/response step fails)
- **THEN** the step status is `fail` with a detail message explaining what was expected

#### Scenario: Warn step
- **WHEN** a selector matches but the element is in an expected state (e.g., send button is disabled on empty input)
- **THEN** the step status is `warn` with a detail message explaining the condition

#### Scenario: Skip step
- **WHEN** a selector field cannot be tested on a new-chat page (e.g., `response` and `completion` selectors have no matching element before any message is sent)
- **THEN** the step status is `skip` with a detail message explaining why

### Requirement: Probe Message Protocol
The system SHALL use dedicated message types for probe communication between the background script and content scripts.

#### Scenario: Background sends PROBE_RUN
- **WHEN** the background script receives a `RUN_PROBE` panel request
- **THEN** it opens a tab via `openTabAndListenForReady` and sends a `PROBE_RUN` message containing `appKey`, `selectors`, and `mode` ("static" or "live") to the content script

#### Scenario: Content script returns PROBE_RESULT
- **WHEN** the content script finishes running the probe
- **THEN** it sends a `PROBE_RESULT` message containing `appKey` and an array of `ProbeStep` objects back to the background script

#### Scenario: Probe coexists with diagnostics
- **WHEN** the probe tool is added to the sidepanel
- **THEN** the existing "Run diagnostics" button SHALL remain functional and unchanged

### Requirement: Probe Sidepanel UI
The system SHALL render a probe panel in the sidepanel with an app selector, mode buttons, and a results checklist.

#### Scenario: App selector dropdown
- **WHEN** the probe panel is rendered
- **THEN** a dropdown lists all enabled apps (ChatGPT, DeepSeek, Qwen, Claude, Gemini, Kimi) for the user to select which app to probe

#### Scenario: Results checklist
- **WHEN** probe results are received
- **THEN** the sidepanel renders each step as a row with an icon (✓/✗/⚠/→), the field name, and the detail message

#### Scenario: Probe running state
- **WHEN** a probe is in progress
- **THEN** both probe buttons SHALL be disabled and a "Probing…" indicator SHALL be shown
