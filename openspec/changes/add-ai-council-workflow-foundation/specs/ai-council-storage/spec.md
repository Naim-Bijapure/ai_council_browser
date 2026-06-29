## ADDED Requirements

### Requirement: Preference Storage
The system SHALL persist lightweight AI Council preferences in `chrome.storage.sync`.

#### Scenario: Default preferences on first run
- **WHEN** no saved preferences exist
- **THEN** all supported apps are selected as agents and ChatGPT is selected as judge

#### Scenario: Agent preferences persist
- **WHEN** the user changes selected agents
- **THEN** the selected agent keys are saved and restored in later side panel sessions

#### Scenario: Judge preference persists
- **WHEN** the user changes the selected judge
- **THEN** the judge app key is saved and restored in later side panel sessions

### Requirement: Session History Storage
The system SHALL persist completed, cancelled, partial, and error council sessions in IndexedDB.

#### Scenario: Session record contains workflow data
- **WHEN** a council session is saved
- **THEN** the record includes id, timestamp, prompt, agents used, judge app, judge chat URL, agent results, status, and duration

#### Scenario: History reads newest first
- **WHEN** the side panel requests history
- **THEN** sessions are returned in reverse chronological order

#### Scenario: Local response text stored
- **WHEN** an agent result includes response text
- **THEN** that response text is stored locally in the IndexedDB session record

### Requirement: Clear History
The system SHALL allow all saved session history to be cleared from IndexedDB.

#### Scenario: Confirmed clear deletes sessions
- **WHEN** the user confirms clearing history
- **THEN** all session records are deleted and the History tab shows an empty state

### Requirement: Storage Boundary
The system SHALL not store the judge's final answer text.

#### Scenario: Judge answer is absent from session record
- **WHEN** a session record is saved
- **THEN** it contains the judge chat URL or null but no captured judge response text
