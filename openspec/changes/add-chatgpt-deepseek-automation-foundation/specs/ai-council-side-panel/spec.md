## ADDED Requirements

### Requirement: Fixed Flow Input State
The side panel SHALL present this phase as a fixed ChatGPT-agent and DeepSeek-judge workflow.

#### Scenario: Fixed apps are visible
- **WHEN** the Council tab is displayed
- **THEN** it shows ChatGPT as the agent and DeepSeek as the judge

#### Scenario: App selectors are hidden for fixed phase
- **WHEN** the fixed-flow phase is active
- **THEN** the side panel does not require the user to choose agent apps or judge apps

### Requirement: Fixed Flow Running State
The side panel SHALL show progress for both the ChatGPT agent step and the DeepSeek judge step.

#### Scenario: ChatGPT status shown
- **WHEN** the ChatGPT agent step changes status
- **THEN** the side panel updates the ChatGPT status display

#### Scenario: DeepSeek status shown
- **WHEN** the DeepSeek judge step changes status
- **THEN** the side panel updates the DeepSeek status display

### Requirement: Final Judge Response Display
The side panel SHALL display the final DeepSeek judge response when the fixed workflow completes successfully.

#### Scenario: DeepSeek judge response shown
- **WHEN** the background reports a completed fixed-flow session with judge response text
- **THEN** the side panel displays the DeepSeek judge response in the session result state

### Requirement: Automation Errors Display
The side panel SHALL display ChatGPT and DeepSeek automation failure reasons using readable status text.

#### Scenario: ChatGPT automation error shown
- **WHEN** the background reports ChatGPT as `error` with an automation error reason
- **THEN** the side panel shows a readable ChatGPT error status

#### Scenario: DeepSeek automation error shown
- **WHEN** the background reports DeepSeek judge execution as `error` with an automation error reason
- **THEN** the side panel shows a readable DeepSeek error status
