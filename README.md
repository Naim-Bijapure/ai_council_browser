# AI Council

A Chrome/Brave extension built with WXT, React, TypeScript, and Manifest V3.

Round 1 implements the AI Council side-panel foundation in demo mode. It lets you enter a prompt, choose agent apps, choose a judge app, watch simulated agent progress, cancel a run, switch to the judge app, and review local session history. It does not automate ChatGPT, Claude, Gemini, DeepSeek, Qwen, or Kimi yet.

## Tech Stack

- WXT for extension entrypoints, manifest generation, development, build, and packaging
- React for the side panel UI
- TypeScript for application, background, and shared domain code
- Manifest V3 for the Chrome extension runtime
- `chrome.storage.sync` for lightweight preferences
- IndexedDB for local session history

## Setup

Install dependencies:

```bash
npm install
```

Start a Chrome-targeted development build:

```bash
npm run dev
```

This project is configured to launch the Flatpak Brave browser by default through `scripts/brave-flatpak`.

You can also run the explicit Brave script:

```bash
npm run dev:brave
```

Or use Flatpak Google Chrome:

```bash
npm run dev:chrome-flatpak
```

If your environment cannot launch Chrome automatically, use manual dev mode:

```bash
npm run dev:manual
```

Then load `.output/chrome-mv3-dev` as an unpacked extension in Chrome or Brave. Keep the dev command running while you edit files.
Manual dev mode runs the local dev server at `http://localhost:3001`.

## Test The Side Panel

1. Run `npm run dev:brave` or `npm run dev:manual`.
2. Load `.output/chrome-mv3-dev` in `brave://extensions` or `chrome://extensions`.
3. Click the AI Council extension action icon.
4. Enter a prompt, keep at least one agent selected, choose a judge, and click Run council.
5. Watch the demo status cards move through injecting, waiting, and done.
6. Use Cancel during a running session to verify cancellation.
7. After handoff, use Switch to judge tab or New question.
8. Open the History tab to verify saved demo sessions and Clear history.

Round 1 uses generated demo responses so the extension architecture can be tested without depending on third-party chat app DOM selectors. Real per-app tab automation belongs in a follow-up OpenSpec change.

## Build

Run TypeScript and WXT compile checks:

```bash
npm run compile
```

Create a production build:

```bash
npm run build
```

Create a distributable zip archive:

```bash
npm run zip
```

## Load In Chrome Or Brave

For production output:

1. Run `npm run build`.
2. Open `chrome://extensions` or `brave://extensions`.
3. Enable Developer mode.
4. Select Load unpacked.
5. Choose the generated `.output/chrome-mv3` directory.

For live development output:

1. Run `npm run dev:manual`.
2. Keep that terminal running.
3. Open `chrome://extensions` or `brave://extensions`.
4. Enable Developer mode.
5. Select Load unpacked.
6. Choose `.output/chrome-mv3-dev`.

Do not choose the `.output` folder itself. Brave/Chrome must be pointed at the exact generated folder that contains `manifest.json`.
Do not use the zip file with Load unpacked; the zip is for distribution/upload workflows.

Use the Reload button on the extension card if Chrome does not pick up a background or manifest-level change automatically.

## Source Layout

```text
entrypoints/
  background.ts         # Manifest V3 background service worker and demo orchestrator
  sidepanel/
    index.html          # Side panel document shell
    main.tsx            # React side panel mount point
    App.tsx             # Council and History UI
    style.css           # Side panel styles
utils/
  appRegistry.ts        # Supported AI app metadata
  format.ts             # UI formatting helpers
  history.ts            # IndexedDB session storage
  judgePrompt.ts        # Structured judge prompt builder
  preferences.ts        # chrome.storage.sync preference helpers
  types.ts              # Shared TypeScript contracts
wxt.config.ts           # WXT and generated manifest configuration
tsconfig.json           # TypeScript configuration
```
