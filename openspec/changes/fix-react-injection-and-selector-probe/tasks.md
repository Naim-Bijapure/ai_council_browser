## 1. Fix React Injection (`_valueTracker` reset)

- [x] 1.1 In `utils/automation/adapterHelpers.ts`, add `delete (element as any)._valueTracker;` before the `InputEvent("input")` dispatch in the `HTMLTextAreaElement` branch of `setInputText`.
- [x] 1.2 Add the same `_valueTracker` deletion in the `HTMLInputElement` branch.
- [x] 1.3 Run `npm run compile` and verify no TypeScript errors.

## 2. Probe Types & Messages

- [x] 2.1 Add `ProbeMode` ("static" | "live"), `ProbeStep`, `ProbeResult` interfaces to `utils/automation/types.ts`.
- [x] 2.2 Add `PROBE_RUN` to `BgToContentMessage` and `PROBE_RESULT` to `ContentToBgMessage` in `utils/automation/messages.ts`.
- [x] 2.3 Add `RUN_PROBE` to `PanelRequest` and `ProbeResult` to `PanelResponse` in `utils/types.ts`.

## 3. Probe Logic

- [x] 3.1 Create `utils/automation/probe.ts` with `runProbeStatic(selectors)` — evaluates each selector field against the DOM, returns `ProbeStep[]`.
- [x] 3.2 Add `runProbeLive(selectors)` to `probe.ts` — injects test prompt, verifies send button, clicks send (or Enter fallback), waits for response, extracts preview text.
- [x] 3.3 Add `PROBE_RUN` handler to `createContentScriptBridge` in `utils/automation/contentBridge.ts` — calls `runProbeStatic` or `runProbeLive` and emits `PROBE_RESULT`.
- [x] 3.4 Add probe handler to all 6 content script entrypoints (`entrypoints/*.content.ts`).
- [x] 3.5 Add `RUN_PROBE` handler in `entrypoints/background.ts` — opens tab via `openTabAndListenForReady`, sends `PROBE_RUN`, listens for `PROBE_RESULT`, returns to sidepanel.

## 4. Sidepanel UI

- [x] 4.1 Add probe state (`probeApp`, `probeRunning`, `probeResult`) to `entrypoints/sidepanel/App.tsx`.
- [x] 4.2 Add app selector dropdown + "Static Probe" / "Live Probe" buttons below the existing diagnostics section.
- [x] 4.3 Add results checklist rendering — map over `ProbeStep[]`, show icon (✓/✗/⚠/→) + field + detail per row.
- [x] 4.4 Add CSS styles for probe panel in `entrypoints/sidepanel/style.css` (probe-block, probe-row, probe-icon-pass/fail/warn/skip).

## 5. Verification

- [x] 5.1 Run `npm run compile` and fix any TypeScript errors.
- [x] 5.2 Run `npm run build` and verify no regressions in manifest/output.
- [ ] 5.3 Manually test: static probe on Qwen → all selector fields pass/warn/skip.
- [ ] 5.4 Manually test: live probe on Qwen → injection passes, send button enables, response extracted.
- [ ] 5.5 Manually test: live probe on ChatGPT + DeepSeek → no regression.
- [ ] 5.6 User review before archiving.
