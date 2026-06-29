## ADDED Requirements

### Requirement: ChatGPT And DeepSeek Host Access
The extension SHALL declare only the ChatGPT and DeepSeek host permissions required for this fixed automation round.

#### Scenario: ChatGPT hosts are permitted
- **WHEN** the Chrome-targeted manifest is generated
- **THEN** the manifest includes host access for `https://chat.openai.com/*` and `https://chatgpt.com/*`

#### Scenario: DeepSeek host is permitted
- **WHEN** the Chrome-targeted manifest is generated
- **THEN** the manifest includes host access for `https://chat.deepseek.com/*`

#### Scenario: Other chat app hosts remain unpermitted
- **WHEN** the Chrome-targeted manifest is generated for this change
- **THEN** it does not add host permissions for Claude, Gemini, Qwen, or Kimi

### Requirement: ChatGPT And DeepSeek Content Script Registration
The extension SHALL register content scripts for ChatGPT and DeepSeek pages through the WXT entrypoint structure.

#### Scenario: ChatGPT content script is included in build output
- **WHEN** a developer runs the Chrome build
- **THEN** the generated extension output includes a content script entry that matches the ChatGPT host patterns

#### Scenario: DeepSeek content script is included in build output
- **WHEN** a developer runs the Chrome build
- **THEN** the generated extension output includes a content script entry that matches the DeepSeek host pattern

#### Scenario: Unsupported pages are not matched
- **WHEN** the generated content script configuration is inspected
- **THEN** it does not match unrelated websites or unsupported chat apps
