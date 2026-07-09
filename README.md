# AI Council Browser

A Chrome/Brave extension (`ai-council-browser`) built with WXT, React, TypeScript, and Manifest V3.

The extension automates a configurable AI Council workflow: it sends your prompt to one or more selected LLM **agents** in parallel (ChatGPT, Claude, Gemini, DeepSeek, Qwen, Kimi, Perplexity, Grok), extracts each response, builds a structured judge prompt from the successful responses, submits it to a selected **judge** app, confirms the message was sent, and captures the judge's conversation permalink. The judge response is never captured — you read the verdict directly in the judge tab.

Which apps are available as agents, as judge, and how they are configured is driven entirely by `config/apps.json` and the per-app `config/selectors/*.json` files.

## Install (Developer mode)

This project is distributed as a **dev preview** (not on the Chrome Web Store).

**End users:** download the release zip and load it unpacked — see **[INSTALL.md](./INSTALL.md)**.

Short version:

1. Download `ai-council-browser-vX.Y.Z.zip` from [GitHub Releases](../../releases).
2. Unzip to a permanent folder.
3. Open `chrome://extensions` (or `brave://extensions`) → enable **Developer mode**.
4. **Load unpacked** → select the folder that contains `manifest.json` (not the `.zip` itself).
5. Click the extension icon to open the side panel.

## Tech Stack

- WXT for extension entrypoints, manifest generation, development, build, and packaging
- React for the side panel UI
- TypeScript for application, background, and shared domain code
- Manifest V3 for the Chrome extension runtime
- `chrome.storage.sync` for lightweight preferences
- IndexedDB for local session history
- JSON-driven app registry and selector configs (no hardcoded app lists)

## Setup

Install dependencies:

```bash
npm install
```

## Development

### Manual dev mode (recommended for real-site testing)

This mode builds the extension and watches files without launching a browser. Use it when you need to test against real logged-in LLM apps in your existing browser profile.

```bash
npm run dev:manual
```

Then:

1. Open your normal Brave/Chrome (the profile where you're logged in to the LLM apps you want to use).
2. Go to `chrome://extensions` (or `brave://extensions`).
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked**.
5. Select `.output/chrome-mv3-dev` (not `.output`, not the zip).
6. Pin the extension and open its side panel.
7. Edit files → WXT rebuilds → the extension auto-reloads via the dev server at `http://localhost:3001`.

### Flatpak Brave notes

If Brave is installed via Flatpak, it may not see your project directory by default. Grant filesystem access:

```bash
flatpak override --user --filesystem=home com.brave.Browser
```

Then fully quit Brave (`flatpak kill com.brave.Browser`) and relaunch it so the new permissions take effect. Closing tabs is not enough — the Flatpak sandbox process must restart.

### Auto-launch dev mode

```bash
npm run dev          # Chrome
npm run dev:brave    # Flatpak Brave (fresh temp profile, no logins)
```

Auto-launch mode starts a clean browser profile — use it for manifest/UI testing only, not for real site automation.

## App Configuration

Supported apps are listed in `config/apps.json`. Each entry defines its key, display name, domain, host match patterns, new-chat URL, and which automation roles it supports.

```json
{
  "apps": [
    {
      "key": "chatgpt",
      "displayName": "ChatGPT",
      "domain": "chat.openai.com",
      "matchPatterns": ["https://chat.openai.com/*", "https://chatgpt.com/*"],
      "newChatUrl": "https://chatgpt.com/",
      "automationRoles": ["agent", "judge"],
      "loginUrlPatterns": ["/auth/login", "/auth/signup"],
      "enabled": true
    }
  ]
}
```

| Field | Required | Purpose |
|---|---|---|
| `key` | Yes | Stable identifier used in selectors, preferences, and history |
| `displayName` | Yes | Human-readable name shown in the side panel |
| `domain` | Yes | Hostname used to match the active tab against an app |
| `matchPatterns` | Yes | Host permissions / content-script match patterns |
| `newChatUrl` | Yes | URL the runner opens to start a fresh conversation |
| `automationRoles` | Yes | Subset of `["agent", "judge"]` — controls availability in the UI |
| `loginUrlPatterns` | Optional | URL substrings that indicate a not-logged-in state |
| `enabled` | Optional (default `true`) | Set to `false` to hide the app from the UI |

### Adding or removing an app

To add a new app:

1. Add a new entry to `config/apps.json` with the fields above.
2. Add a corresponding `config/selectors/<key>.json` with native-CSS selectors.
3. Add a new WXT content-script entrypoint under `entrypoints/<key>.content.ts` that wires `createContentScriptBridge` to `runAgent` / `runJudge` from `utils/automation/genericAdapter.ts`.
4. Add the new match pattern to `wxt.config.ts` `hostPermissions`.

To remove an app, set its `enabled: false` (or delete its entry) — the side panel and the runner will skip it on the next build.

## Selector Configuration

DOM selectors for each app live in editable JSON files under `config/selectors/`:

```text
config/selectors/chatgpt.json
config/selectors/claude.json
config/selectors/deepseek.json
config/selectors/gemini.json
config/selectors/kimi.json
config/selectors/qwen.json
```

Each file contains ordered selector arrays (native CSS only — no `:has-text()` or `:has()` pseudo-selectors). The adapter tries each selector in priority order until one matches a live element.

### Selector groups

| Group | Required | Purpose |
|---|---|---|
| `input` | Yes | CSS selectors for the chat input element (textarea or contenteditable div) |
| `send` | Yes | CSS selectors for the send button |
| `response` | Yes | CSS selectors for the assistant response container |
| `completion` | Yes | CSS selectors for the stop-generation button (used for completion detection) |
| `blocked` | Optional | CSS selectors for rate-limit/CAPTCHA UI |
| `loginError` | Optional | CSS selectors for login page elements |

### Updating selectors

If the extension reports `dom_error` or `not_logged_in` incorrectly:

1. Open the affected app in your browser.
2. Inspect the chat input element, send button, response container, and stop button.
3. Copy their CSS selectors into the corresponding JSON file.
4. Reload the extension (`Alt+R` or via `chrome://extensions`).
5. Run diagnostics again to verify.

The selector JSON is bundled at build time. After editing, the extension must be rebuilt (`npm run dev:manual` auto-rebuilds on file change).

## Test The Workflow

### Prerequisites

- You must be **logged in** to the apps you want to use in the browser profile you use for testing:
  - ChatGPT — `chatgpt.com`
  - Claude — `claude.ai`
  - Gemini — `gemini.google.com`
  - DeepSeek — `chat.deepseek.com`
  - Qwen — `chat.qwen.ai`
  - Kimi — `kimi.moonshot.cn`
- Run `npm run dev:manual` and load the extension as described above.

### Run diagnostics

Before running the full council, verify that the extension can detect the chat UIs:

1. Open the side panel.
2. Pick one or more agents in the **Agents** section.
3. Click **Run diagnostics**.
4. The extension opens tabs for the selected agents and reports Ready/error status for each.
5. If any report an error, inspect the real DOM and update that app's selector JSON.

### Run the council

1. Tick one or more **Agents**.
2. Pick the **Judge** app from the dropdown (the selected judge is automatically excluded from the agent list).
3. Enter a prompt in the textarea.
4. Click **Run council**.
5. The extension opens tabs for each agent, sends your prompt in parallel, waits for each response, and extracts it.
6. It builds a structured judge prompt from the successful responses and sends it to the judge app.
7. Once the judge prompt is sent, the panel shows **"Judge is running in [App Name]"** with a **Switch to judge tab** button.
8. Click **Switch to judge tab** to open the judge's conversation and read the verdict.
9. Click **New question** to reset and start over.
10. Use **Cancel** during execution to abort the run.
11. Check the **History** tab for saved sessions. Each row shows the timestamp, status, agent count, and judge app. Rows with a captured judge URL are tappable; rows with `Judge URL unavailable` are dimmed/non-tappable.

Your agent and judge selections are saved to `chrome.storage.sync` and restored on the next side-panel open.

## Timeouts

| Phase | Timeout |
|---|---|
| Tab load | 15 seconds |
| Content script readiness (CONTENT_READY handshake) | 10 seconds |
| Login grace period (polling for input element) | 10 seconds |
| Send button enable wait | 3 seconds |
| Agent response wait | 45 seconds |
| Judge URL capture | 30 seconds |

## Known Limitations

- The judge response is never captured or stored. The user reads it directly in the judge app's tab.
- If the judge app doesn't change its URL within 30 seconds of sending the judge prompt, `judgeChatUrl` is stored as null and the history row is dimmed/non-tappable.
- One session at a time. The submit button is disabled while a session is in progress.
- Selector values for Claude, Gemini, Qwen, and Kimi are placeholders. Real DOM values must be updated after inspecting each app's live UI (the diagnostic flow helps find the right selectors).

## Build

Run TypeScript and WXT compile checks:

```bash
npm run compile
```

Create a production build:

```bash
npm run build
```

Create a distributable zip and copy it to `releases/`:

```bash
npm run release
# → releases/ai-council-browser-v0.1.0.zip
```

(`npm run zip` only builds the zip under `.output/` without copying.)

### Publish a GitHub Release (maintainers)

```bash
npm run release
gh release create v0.1.0 releases/ai-council-browser-v0.1.0.zip \
  --title "v0.1.0 — Dev preview" \
  --notes "Pre-built extension for load-unpacked install. See INSTALL.md."
```

Or create the release in the GitHub UI and upload `releases/ai-council-browser-v0.1.0.zip` as an asset.

## Load In Chrome Or Brave

**From a release zip:** follow [INSTALL.md](./INSTALL.md).

**From a local production build:**

1. Run `npm run build`.
2. Open `chrome://extensions` or `brave://extensions`.
3. Enable Developer mode.
4. Select Load unpacked.
5. Choose the generated `.output/chrome-mv3` directory.

**For live development output:**

1. Run `npm run dev:manual`.
2. Keep that terminal running.
3. Open `chrome://extensions` or `brave://extensions`.
4. Enable Developer mode.
5. Select Load unpacked.
6. Choose `.output/chrome-mv3-dev`.

Do not choose the `.output` folder itself. Brave/Chrome must be pointed at the exact generated folder that contains `manifest.json`.  
Do not use the zip file with Load unpacked — unzip first, then load the folder.

## Source Layout

```text
config/
  apps.json                    # Supported apps + automation roles (data)
  selectors/
    chatgpt.json               # ChatGPT DOM selectors
    claude.json                # Claude DOM selectors
    deepseek.json              # DeepSeek DOM selectors
    gemini.json                # Gemini DOM selectors
    kimi.json                  # Kimi DOM selectors
    qwen.json                  # Qwen DOM selectors
entrypoints/
  background.ts                # MV3 background service worker, multi-agent orchestrator
  chatgpt.content.ts           # ChatGPT content script
  claude.content.ts            # Claude content script
  deepseek.content.ts          # DeepSeek content script
  gemini.content.ts            # Gemini content script
  kimi.content.ts              # Kimi content script
  qwen.content.ts              # Qwen content script
  sidepanel/
    index.html                 # Side panel document shell
    main.tsx                   # React side panel mount point
    App.tsx                    # Council, diagnostics, and History UI
    style.css                  # Side panel styles
utils/
  appRegistry.ts               # Loads config/apps.json, exposes app/role helpers
  format.ts                    # UI formatting helpers
  history.ts                   # IndexedDB session storage
  judgePrompt.ts               # Structured judge prompt builder
  preferences.ts               # chrome.storage.sync preference helpers
  types.ts                     # Shared TypeScript contracts
  automation/
    types.ts                   # Automation types (timeouts, results, selectors)
    messages.ts                # Typed runtime message bridge (bg ↔ content scripts)
    selectorConfig.ts          # Selector JSON loader (all 6 apps)
    readiness.ts               # Login grace period + input detection
    adapterHelpers.ts          # Shared DOM helpers (inject, send, extract)
    genericAdapter.ts          # Single adapter driving any app from its selector JSON
    contentBridge.ts           # Content script message bridge factory
    diagnostics.ts             # Background diagnostic helpers (open tabs, handshake)
    councilRunner.ts           # Multi-agent orchestrator (replaces fixedFlowRunner)
wxt.config.ts                  # WXT and generated manifest configuration
tsconfig.json                  # TypeScript configuration
```
