## ADDED Requirements

### Requirement: JSON Selector Config Files
The system SHALL store app-specific DOM selector values in editable JSON config files.

#### Scenario: ChatGPT selector config exists
- **WHEN** the ChatGPT adapter is built
- **THEN** it reads DOM lookup values from a ChatGPT JSON selector config file

#### Scenario: DeepSeek selector config exists
- **WHEN** the DeepSeek adapter is built
- **THEN** it reads DOM lookup values from a DeepSeek JSON selector config file

### Requirement: Selector Config Shape
Each selector config file SHALL define ordered selector groups for the DOM interactions needed by automation.

#### Scenario: Required groups are present
- **WHEN** a selector config is loaded
- **THEN** it contains selector groups for input, send button, response containers, and completion detection

#### Scenario: Optional groups are present
- **WHEN** a selector config is loaded
- **THEN** it can include optional groups for login detection, blocked state detection, error state detection, and stop-generation controls

### Requirement: Selector Config Validation
The system SHALL validate selector config before attempting DOM automation.

#### Scenario: Invalid config is rejected
- **WHEN** a selector config is missing required selector groups or contains empty required selectors
- **THEN** the adapter returns a readable config error

#### Scenario: User updates config
- **WHEN** the user changes selector values in the JSON config and reloads the extension build
- **THEN** the adapter uses the updated selector values without requiring TypeScript code changes
