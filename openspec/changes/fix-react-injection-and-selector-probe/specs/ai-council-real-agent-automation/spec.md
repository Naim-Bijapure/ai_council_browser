## MODIFIED Requirements

### Requirement: Fixed App Tab Runner
The system SHALL provide reusable background tab runner behavior for any configured app as agent or judge, with framework-aware text injection that resets React's value tracker before dispatching input events.

#### Scenario: Agent tab runner starts as background tab
- **WHEN** the workflow starts the agent step for a selected app
- **THEN** the tab runner opens a new tab with `active: false` in the current window for that app's new-chat URL, and waits for content-script readiness

#### Scenario: Agent tab is briefly activated for injection
- **WHEN** the agent content script is ready and the runner is about to send the AGENT_RUN command
- **THEN** the tab runner activates the agent tab so that focus-dependent DOM operations (execCommand, click) work without Chrome background-tab throttling, then switches back to the user's original tab after injection

#### Scenario: Judge tab runner starts in active window
- **WHEN** the workflow starts the judge step
- **THEN** the tab runner opens the judge app's new-chat URL in the active window (reusing the current tab if it matches the judge app, otherwise opening a new tab in that window) and waits for content-script readiness

#### Scenario: Agent tab creation fallback
- **WHEN** creating a background tab fails
- **THEN** the tab runner falls back to opening a new tab with `active: true` in the current window

#### Scenario: React-controlled input injection
- **WHEN** the input element is a React-controlled textarea or input (has a `_valueTracker` property)
- **THEN** the injection code SHALL delete `_valueTracker` before dispatching the `input` event, so React's `onChange` callback fires and the framework's internal state updates

#### Scenario: Non-React input injection
- **WHEN** the input element does not have a `_valueTracker` property
- **THEN** the deletion is a no-op and the injection proceeds normally with the native value setter + `InputEvent` + `change` event

#### Scenario: Send button not found fallback
- **WHEN** the send button is not found or remains disabled after the send-button enable timeout
- **THEN** the adapter SHALL dispatch an Enter key sequence (keydown, keypress, keyup with `key: "Enter"`, `code: "Enter"`, `keyCode: 13`) on the input element as a submission fallback

#### Scenario: Send button found and clicked
- **WHEN** the send button is found and enabled within the timeout
- **THEN** the adapter SHALL click the send button and NOT dispatch the Enter key fallback
