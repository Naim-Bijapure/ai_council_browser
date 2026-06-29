## ADDED Requirements

### Requirement: Run Request Validation
The background orchestrator SHALL validate every council run request before creating a session.

#### Scenario: Empty prompt rejected
- **WHEN** the side panel submits an empty or whitespace-only prompt
- **THEN** the orchestrator rejects the request with `Please enter a prompt`

#### Scenario: Missing agents rejected
- **WHEN** the side panel submits no selected agents
- **THEN** the orchestrator rejects the request with `Select at least one agent`

#### Scenario: Long prompt rejected
- **WHEN** the side panel submits a prompt longer than 10000 characters
- **THEN** the orchestrator rejects the request with `Prompt is too long (max 10,000 characters)`

#### Scenario: Same app as agent and judge accepted
- **WHEN** the selected judge app is also in the selected agents list
- **THEN** the orchestrator accepts the request

### Requirement: Single Active Session
The background orchestrator SHALL allow only one active council session at a time.

#### Scenario: Second run blocked while active
- **WHEN** a council session is already running
- **THEN** another run request is rejected until the active session is resolved or cancelled

### Requirement: Demo Agent Execution
The first implementation round SHALL simulate agent execution through the normal orchestration status model without automating external chat apps.

#### Scenario: Demo run emits live status updates
- **WHEN** a valid council run starts
- **THEN** each selected agent moves through observable statuses including `injecting`, `waiting`, and a resolved status

#### Scenario: Demo run produces response previews
- **WHEN** a demo agent resolves with `done`
- **THEN** the orchestrator includes response text that the side panel can preview and store

### Requirement: Judge Prompt Builder
The orchestrator SHALL build a structured judge prompt from the original user prompt and resolved agent results.

#### Scenario: Done agent response included
- **WHEN** an agent result has status `done`
- **THEN** the judge prompt includes that agent name and response text

#### Scenario: Timeout result included as unavailable
- **WHEN** an agent result has status `timeout`
- **THEN** the judge prompt states that the agent timed out

#### Scenario: Error result included as unavailable
- **WHEN** an agent result has status `error`
- **THEN** the judge prompt states that the agent encountered the recorded error reason

#### Scenario: All agents failed skips judge handoff
- **WHEN** every selected agent resolves as `timeout` or `error`
- **THEN** the orchestrator completes the session as `partial_failure` without judge handoff

### Requirement: Cancellation
The background orchestrator SHALL support cancellation of an active session.

#### Scenario: Cancel active session
- **WHEN** the side panel sends a cancel request during execution
- **THEN** the orchestrator stops demo execution, saves a cancelled session record, and clears the active session

### Requirement: State Broadcasts
The background orchestrator SHALL broadcast active session changes to the side panel.

#### Scenario: Side panel receives current state
- **WHEN** the side panel connects or asks for current state
- **THEN** the background returns the active session snapshot or an idle state
