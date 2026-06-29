## ADDED Requirements

### Requirement: Fixed Automation Role Metadata
The app registry SHALL expose which apps are supported for the fixed automation roles in this phase.

#### Scenario: ChatGPT marked as only automated agent
- **WHEN** the system reads the ChatGPT registry entry
- **THEN** the entry indicates that ChatGPT is available as the automated agent for this phase

#### Scenario: DeepSeek marked as only automated judge
- **WHEN** the system reads the DeepSeek registry entry
- **THEN** the entry indicates that DeepSeek is available as the automated judge for this phase

#### Scenario: Other apps not enabled for this phase
- **WHEN** the system reads Claude, Gemini, Qwen, or Kimi registry entries
- **THEN** each entry indicates that it is not enabled for fixed-flow automation in this phase

#### Scenario: Orchestrator uses fixed role metadata
- **WHEN** the background orchestrator starts a fixed-flow run
- **THEN** it uses ChatGPT for the agent role and DeepSeek for the judge role
