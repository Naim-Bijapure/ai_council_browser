## ADDED Requirements

### Requirement: ChatGPT Selector Config Usage
The ChatGPT adapter SHALL use the ChatGPT selector JSON config for DOM lookup values.

#### Scenario: Selector config is loaded
- **WHEN** the ChatGPT content script initializes
- **THEN** it loads the ChatGPT selector config before readiness or prompt submission

#### Scenario: Required selector group missing
- **WHEN** the ChatGPT selector config is missing a required selector group
- **THEN** the adapter returns a readable config error instead of attempting DOM automation

### Requirement: ChatGPT Readiness Detection
The ChatGPT adapter SHALL detect whether a ChatGPT page is usable for prompt submission.

#### Scenario: Chat input is available
- **WHEN** the ChatGPT page contains a usable prompt input matched by selector config
- **THEN** the adapter reports itself ready for automation

#### Scenario: ChatGPT is not usable
- **WHEN** the ChatGPT page does not expose a usable prompt input because of login, loading, or unexpected DOM state
- **THEN** the adapter reports a clear readiness failure instead of accepting a prompt command

### Requirement: ChatGPT Prompt Submission
The ChatGPT adapter SHALL submit the user's original prompt to ChatGPT through the page UI.

#### Scenario: Prompt is injected and sent
- **WHEN** the background sends a ChatGPT automation command with a valid prompt
- **THEN** the adapter writes the prompt into the ChatGPT input and triggers the send action using configured selectors

#### Scenario: Send control is disabled
- **WHEN** the prompt cannot be submitted because the send control stays disabled
- **THEN** the adapter returns an error with reason `send_button_disabled`

### Requirement: ChatGPT Response Waiting
The ChatGPT adapter SHALL wait for ChatGPT to finish generating the assistant response before extracting text.

#### Scenario: Generation completes
- **WHEN** ChatGPT produces a response and the response text becomes stable
- **THEN** the adapter returns the final assistant response text

#### Scenario: Generation does not complete in time
- **WHEN** ChatGPT does not produce a stable final response within the configured timeout
- **THEN** the adapter returns a timeout result

### Requirement: ChatGPT Response Extraction
The ChatGPT adapter SHALL extract the latest assistant response text from the ChatGPT conversation.

#### Scenario: Latest assistant response selected
- **WHEN** multiple assistant responses exist in the ChatGPT page
- **THEN** the adapter returns the most recent assistant response associated with the submitted prompt

#### Scenario: Empty response rejected
- **WHEN** the adapter cannot extract non-empty assistant text
- **THEN** the adapter returns an error with reason `dom_error`
