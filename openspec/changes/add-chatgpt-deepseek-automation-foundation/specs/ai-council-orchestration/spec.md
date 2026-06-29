## ADDED Requirements

### Requirement: Fixed ChatGPT To DeepSeek Workflow
The background orchestrator SHALL run a fixed automation workflow with ChatGPT as the only agent and DeepSeek as the only judge.

#### Scenario: Valid fixed-flow run starts
- **WHEN** the side panel submits a valid prompt for the fixed-flow run
- **THEN** the orchestrator starts a session using ChatGPT as the agent and DeepSeek as the judge

#### Scenario: App selections are not required
- **WHEN** the fixed-flow side panel starts a run
- **THEN** the orchestrator does not require user-selected agent or judge app lists

### Requirement: ChatGPT Agent Then DeepSeek Judge Order
The background orchestrator SHALL complete the ChatGPT agent step before submitting the DeepSeek judge step.

#### Scenario: ChatGPT response succeeds
- **WHEN** ChatGPT automation returns response text
- **THEN** the orchestrator builds the judge prompt from the original user prompt and ChatGPT response

#### Scenario: ChatGPT response fails
- **WHEN** ChatGPT automation resolves as timeout or error
- **THEN** the orchestrator does not submit a DeepSeek judge prompt and completes the session with the recorded ChatGPT failure

#### Scenario: DeepSeek judge succeeds
- **WHEN** DeepSeek automation returns judge response text
- **THEN** the orchestrator completes the session with the final judge response

### Requirement: Fixed Workflow Status Broadcasts
The background orchestrator SHALL broadcast ChatGPT agent and DeepSeek judge status changes through the side-panel snapshot model.

#### Scenario: ChatGPT progresses
- **WHEN** ChatGPT moves through readiness, injection, waiting, and completion
- **THEN** the side panel receives updated snapshots for the agent step

#### Scenario: DeepSeek progresses
- **WHEN** DeepSeek moves through readiness, injection, waiting, and completion
- **THEN** the side panel receives updated snapshots for the judge step

#### Scenario: Fixed workflow fails
- **WHEN** ChatGPT or DeepSeek automation fails with a known error reason
- **THEN** the side panel receives an updated snapshot showing the failure without crashing the extension
