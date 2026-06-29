## ADDED Requirements

### Requirement: Fixed App Tab Runner
The system SHALL provide reusable background tab runner behavior for the fixed ChatGPT and DeepSeek automation steps.

#### Scenario: ChatGPT tab runner starts
- **WHEN** the fixed workflow starts the agent step
- **THEN** the tab runner opens or targets a ChatGPT chat tab and waits for ChatGPT content-script readiness

#### Scenario: DeepSeek tab runner starts
- **WHEN** the fixed workflow starts the judge step
- **THEN** the tab runner opens or targets a DeepSeek chat tab and waits for DeepSeek content-script readiness

### Requirement: Content Script Readiness
The tab runner SHALL verify content-script readiness before sending automation commands.

#### Scenario: Content script becomes ready
- **WHEN** the opened chat tab loads and the matching content script responds to a readiness probe
- **THEN** the runner sends the next automation command for that app

#### Scenario: Content script readiness times out
- **WHEN** the content script does not respond within the configured readiness timeout
- **THEN** the active step resolves as `error` with reason `content_script_timeout`

### Requirement: Automation Timeouts
The tab runner SHALL enforce bounded timeouts for tab load, prompt send, response wait, and response extraction.

#### Scenario: Tab load timeout
- **WHEN** the chat tab does not reach a usable loading state within the configured tab timeout
- **THEN** the active step resolves as `error` with reason `tab_load_timeout`

#### Scenario: Response wait timeout
- **WHEN** ChatGPT or DeepSeek does not produce a final response before the configured response timeout
- **THEN** the active step resolves as `timeout`

### Requirement: Fixed Workflow Cancellation
The tab runner SHALL stop pending automation work when the user cancels the active council session.

#### Scenario: User cancels during ChatGPT automation
- **WHEN** the side panel sends `CANCEL_COUNCIL` during the ChatGPT agent step
- **THEN** pending ChatGPT timers and listeners are cleaned up and the session is marked cancelled

#### Scenario: User cancels during DeepSeek automation
- **WHEN** the side panel sends `CANCEL_COUNCIL` during the DeepSeek judge step
- **THEN** pending DeepSeek timers and listeners are cleaned up and the session is marked cancelled

### Requirement: Automation Result Normalization
The tab runner SHALL normalize content-script outcomes into the session model.

#### Scenario: ChatGPT response extracted
- **WHEN** the ChatGPT content script returns final response text
- **THEN** the ChatGPT agent result is marked `done` with the extracted response text and a completion timestamp

#### Scenario: DeepSeek response extracted
- **WHEN** the DeepSeek content script returns final judge response text
- **THEN** the session stores the judge response text and marks the judge step complete

#### Scenario: Adapter error returned
- **WHEN** a content script returns an adapter error reason
- **THEN** the active step is marked `error` with that reason
