## ADDED Requirements

### Requirement: Council Input State
The side panel SHALL provide a Council tab where the user can enter a prompt, select one or more agent apps, select a judge app, and start a council run.

#### Scenario: Submit disabled for invalid input
- **WHEN** the prompt is empty, no agents are selected, or no judge is selected
- **THEN** the Run council action is disabled

#### Scenario: Character count is visible
- **WHEN** the user types in the prompt textarea
- **THEN** the side panel shows the current prompt character count

#### Scenario: Preferences prefill controls
- **WHEN** saved agent or judge preferences exist
- **THEN** the side panel initializes the Council controls from those preferences

### Requirement: Council Running State
The side panel SHALL show live execution progress after a valid council run starts.

#### Scenario: Prompt locks during execution
- **WHEN** a council run is active
- **THEN** the prompt and selection controls are not editable

#### Scenario: Agent cards update individually
- **WHEN** an agent status update is received
- **THEN** the matching agent card updates without waiting for other agents

#### Scenario: Progress reflects resolved agents
- **WHEN** an agent reaches `done`, `timeout`, or `error`
- **THEN** the progress indicator updates the completed count against the total selected agents

### Requirement: Cancel Active Run
The side panel SHALL allow the user to cancel an active council run.

#### Scenario: Cancel returns to input state
- **WHEN** the user clicks Cancel during execution
- **THEN** the side panel sends a cancel request and returns to the input state after cancellation is confirmed

### Requirement: Judge Handoff State
The side panel SHALL show a minimal judge handoff state after agent execution resolves and the judge prompt is handed off by the orchestrator.

#### Scenario: Handoff displays judge app
- **WHEN** the background reports that the judge handoff is ready
- **THEN** the side panel shows the selected judge app name and a Switch to judge tab action

#### Scenario: New question resets session UI
- **WHEN** the user clicks New question in the handoff state
- **THEN** the side panel clears active run state and returns to the Council input state

### Requirement: History Tab
The side panel SHALL provide a History tab listing saved council sessions in reverse chronological order.

#### Scenario: History row shows summary
- **WHEN** saved sessions exist
- **THEN** each row shows a prompt preview, timestamp, agent count, and judge app name

#### Scenario: Missing judge URL is dimmed
- **WHEN** a saved session has no judge chat URL
- **THEN** the row is visually dimmed and does not open a tab when selected

#### Scenario: Clear history asks for confirmation
- **WHEN** the user chooses to clear history
- **THEN** the side panel asks for confirmation before deleting stored sessions
