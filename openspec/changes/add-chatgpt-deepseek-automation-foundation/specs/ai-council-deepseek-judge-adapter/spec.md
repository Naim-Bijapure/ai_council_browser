## ADDED Requirements

### Requirement: DeepSeek Selector Config Usage
The DeepSeek judge adapter SHALL use the DeepSeek selector JSON config for DOM lookup values.

#### Scenario: Selector config is loaded
- **WHEN** the DeepSeek content script initializes
- **THEN** it loads the DeepSeek selector config before readiness or judge prompt submission

#### Scenario: Required selector group missing
- **WHEN** the DeepSeek selector config is missing a required selector group
- **THEN** the adapter returns a readable config error instead of attempting DOM automation

### Requirement: DeepSeek Readiness Detection
The DeepSeek judge adapter SHALL detect whether a DeepSeek page is usable for judge prompt submission.

#### Scenario: Judge input is available
- **WHEN** the DeepSeek page contains a usable prompt input matched by selector config
- **THEN** the adapter reports itself ready for judge automation

#### Scenario: DeepSeek is not usable
- **WHEN** the DeepSeek page does not expose a usable prompt input because of login, loading, or unexpected DOM state
- **THEN** the adapter reports a clear readiness failure instead of accepting a judge prompt command

### Requirement: DeepSeek Judge Prompt Submission
The DeepSeek judge adapter SHALL submit the generated judge prompt to DeepSeek through the page UI.

#### Scenario: Judge prompt is injected and sent
- **WHEN** the background sends a DeepSeek judge command with a generated judge prompt
- **THEN** the adapter writes the judge prompt into the DeepSeek input and triggers the send action using configured selectors

#### Scenario: Send control is disabled
- **WHEN** the judge prompt cannot be submitted because the send control stays disabled
- **THEN** the adapter returns an error with reason `send_button_disabled`

### Requirement: DeepSeek Judge Response Waiting
The DeepSeek judge adapter SHALL wait for DeepSeek to finish generating the judge response before extracting text.

#### Scenario: Judge generation completes
- **WHEN** DeepSeek produces a response and the response text becomes stable
- **THEN** the adapter returns the final judge response text

#### Scenario: Judge generation does not complete in time
- **WHEN** DeepSeek does not produce a stable final response within the configured timeout
- **THEN** the adapter returns a timeout result

### Requirement: DeepSeek Judge Response Extraction
The DeepSeek judge adapter SHALL extract the latest judge response text from the DeepSeek conversation.

#### Scenario: Latest judge response selected
- **WHEN** multiple DeepSeek responses exist in the page
- **THEN** the adapter returns the most recent response associated with the submitted judge prompt

#### Scenario: Empty judge response rejected
- **WHEN** the adapter cannot extract non-empty judge response text
- **THEN** the adapter returns an error with reason `dom_error`
