# Install AI Council (Developer Mode)

This is a **dev preview** release. The extension is **not** on the Chrome Web Store. You install it manually with Chrome/Brave **Developer mode**.

## Prerequisites

- **Chrome** or **Brave** (Chromium-based)
- Accounts/sessions already logged in on the LLM sites you want to use (ChatGPT, Claude, Gemini, DeepSeek, Qwen, Kimi, Perplexity, Grok, etc.)
- A place to keep the extension files permanently (do not leave them only in a temp folder that gets deleted)

## Install from a release zip (recommended)

1. Download `ai-council-vX.Y.Z.zip` from this repo’s **[GitHub Releases](../../releases)** page  
   (or use the file from `releases/` if you built it yourself).
2. **Unzip** it somewhere permanent, for example:
   - `~/Extensions/ai-council/`
   - `C:\Extensions\ai-council\`
3. Open the extensions page:
   - Chrome: `chrome://extensions`
   - Brave: `brave://extensions`
4. Turn on **Developer mode** (top-right toggle).
5. Click **Load unpacked**.
6. Select the **unzipped folder that contains `manifest.json`**  
   (not the `.zip` file, and not a parent folder that only contains another folder).
7. Pin **AI Council** if you like, then click the extension icon to open the **side panel**.

### Zip layout note

The zip root should look roughly like:

```text
manifest.json
background.js
sidepanel.html
icon-16.png
icon-32.png
icon-48.png
icon-128.png
assets/
chunks/
content-scripts/
```

If after unzipping you see a single nested folder, open that nested folder until you see `manifest.json`, then load **that** folder.

## First run

1. Open the AI Council side panel.
2. Select agents and a judge.
3. Enter a prompt and run a council session.
4. Stay logged in on each selected app’s site; the extension opens tabs and automates those pages in your browser.

## Update to a newer zip

1. Download and unzip the new release (you can overwrite the old folder, or use a new folder).
2. On `chrome://extensions` / `brave://extensions`:
   - If you **replaced files in the same folder**: click **Reload** on AI Council.
   - If you used a **new folder**: **Remove** the old extension, then **Load unpacked** again and pick the new folder.

## Build from source instead

```bash
npm install
npm run build
```

Then **Load unpacked** → select `.output/chrome-mv3` (must contain `manifest.json`).

For packaging a zip yourself:

```bash
npm run release
# → releases/ai-council-v0.1.0.zip
```

See the main [README](./README.md) for development details.

## Notes and limitations

- **Not signed / not store-distributed.** Chrome will show a developer-mode warning; that is expected.
- **Permissions:** the extension needs access to the supported AI chat sites so it can inject content scripts and run the workflow.
- **Local data only:** preferences and session history stay in your browser (`chrome.storage` + IndexedDB). There is no AI Council backend.
- **DOM automation can break** when ChatGPT, Claude, Gemini, etc. change their UI. If a site stops working, selectors may need an update.
- Keep the extension folder on disk. If you delete or move it, Chrome may disable the extension until you load it again.
- **License:** AI Council is open source ([MIT](./LICENSE)). Third-party AI sites and trademarks are separate; see [NOTICE](./NOTICE).
- Comply with each AI site’s terms of use when automating it.

## Troubleshooting

| Problem | What to try |
|--------|-------------|
| “Manifest file is missing or unreadable” | You selected the wrong folder. Find the directory that directly contains `manifest.json`. |
| Side panel does not open | Click the extension action icon in the toolbar. Ensure the extension is enabled. |
| Agent fails / not logged in | Open that app in a normal tab, log in, then retry. |
| Extension disappeared after reboot | The folder was moved/deleted. Load unpacked again from the permanent path. |
