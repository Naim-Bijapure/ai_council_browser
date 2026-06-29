## ADDED Requirements

### Requirement: Fixed Workflow Judge Response Storage
The system SHALL persist the final DeepSeek judge response for completed fixed-flow sessions.

#### Scenario: Judge response is saved
- **WHEN** DeepSeek automation completes with judge response text
- **THEN** the stored session record includes that judge response text

#### Scenario: Judge failure is saved
- **WHEN** DeepSeek automation fails or times out
- **THEN** the stored session record includes the DeepSeek status and error reason

### Requirement: Fixed Workflow URL Storage
The system SHALL persist relevant ChatGPT and DeepSeek tab URLs when available.

#### Scenario: ChatGPT URL is saved
- **WHEN** the ChatGPT agent tab URL is available during session completion
- **THEN** the stored session record includes the ChatGPT URL

#### Scenario: DeepSeek URL is saved
- **WHEN** the DeepSeek judge tab URL is available during session completion
- **THEN** the stored session record includes the DeepSeek URL
