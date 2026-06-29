## Context

The repository currently has a WXT, React, TypeScript, and Manifest V3 extension foundation. The workflow describes a larger AI Council product that coordinates several web chat applications through browser tabs, content scripts, and a side panel. Direct automation of third-party chat UIs is brittle, so the first implementation round should establish the internal extension architecture before introducing app-specific selectors and DOM automation.

The side panel is the natural primary surface because the workflow requires long-running state, live progress, cancellation, and history browsing. The background service worker should own orchestration because it can manage tabs, receive content-script signals, and keep one active session independent of side panel remounts.

## Goals / Non-Goals

**Goals:**

- Build the first AI Council product slice as a side panel, not a popup.
- Define shared TypeScript types for apps, sessions, agent results, status updates, messages, preferences, and stored history.
- Provide a supported app registry for ChatGPT, Claude, Gemini, DeepSeek, Qwen, and Kimi.
- Implement input validation, selected agents, selected judge, run state, status cards, cancellation, minimal judge handoff, and history display.
- Persist preferences in `chrome.storage.sync` and session records in IndexedDB.
- Use a local/demo orchestration adapter for Round 1 so the user can test the full panel state machine without opening or automating external chat apps.
- Keep clear extension boundaries so later rounds can replace the demo adapter with tab/content-script automation.

**Non-Goals:**

- Real prompt injection into ChatGPT, Claude, Gemini, DeepSeek, Qwen, or Kimi.
- Login detection, selector arrays, stop-button detection, DOM stabilisation, response extraction, CAPTCHA/rate-limit handling, or user-interference detection.
- Remote selector config, settings page for manual selector overrides, and production Web Store packaging decisions.
- Capturing or displaying the judge model's final answer inside the extension.
- Multi-session concurrency.

## Decisions

### Use Side Panel As The Primary UI

The extension will configure WXT for a side panel entrypoint and keep the existing React stack. The side panel can remain visible while tabs change, which fits the long-running council workflow better than a popup that closes when focus changes.

Alternative considered: keep the popup as the primary UI. This is simpler, but it is a poor fit for progress monitoring and tab switching.

### Keep Background As The Session Owner

The side panel will send typed messages to the background service worker. The background will validate requests, create the active session, simulate agent progress in Round 1, build the judge prompt, save history, and broadcast updates back to the side panel.

Alternative considered: put orchestration directly in React state. That would be easier for a demo, but it would not survive panel reloads and would have to be rewritten when tab automation is added.

### Add A Demo Execution Adapter First

Round 1 will not automate real chat apps. Instead, the background will use a demo adapter that marks selected agents through realistic statuses such as `pending`, `injecting`, `waiting`, and `done`, then enters the judge handoff state with a generated judge prompt preview or placeholder URL state.

Alternative considered: implement real content scripts immediately. That would create more visible progress, but it would mix architecture work with fragile selector research across six fast-changing sites.

### Store Only Local History

Preferences will use `chrome.storage.sync` because they are small and user-specific. Session history will use IndexedDB because it can hold larger prompts and agent responses locally without syncing sensitive content across devices.

Alternative considered: use only `chrome.storage.local`. This would be simpler, but IndexedDB matches the workflow's history model and scales better for response text.

### Define App Registry Before Adapters

The supported apps will be represented by a single registry with stable app keys, display names, domains, new-chat URLs, and capability metadata. Future selectors and adapters can attach to the same keys.

Alternative considered: hard-code app lists directly in UI controls. This would duplicate data and make later content-script wiring messier.

### Use Typed Message Contracts

Panel-background communication will use explicit TypeScript message unions instead of loose string messages. This gives future content scripts and adapters a stable contract and makes workflow changes easier to review.

Alternative considered: ad hoc `chrome.runtime.sendMessage` payloads. This is fast initially, but it creates hidden coupling as the workflow grows.

## Risks / Trade-offs

- Demo mode may feel less complete than real tab automation -> Label this first round clearly as architecture/demo execution and keep the task list explicit about later automation rounds.
- Background service workers can be restarted by Chrome -> Persist enough session/history state for completed records and design active-session recovery as a later improvement if needed.
- IndexedDB wrappers can add complexity -> Keep the storage module small, typed, and limited to session history operations in Round 1.
- Side panel APIs differ across Chromium browsers -> Keep WXT configuration conventional and verify in Brave/Chrome via the existing Flatpak dev flow.
- Future third-party selectors may break often -> Keep app-specific adapter code isolated from the side panel and orchestration core.

## Migration Plan

1. Add shared domain modules for app registry, session models, messages, judge prompt building, preferences, and history storage.
2. Add a WXT side panel entrypoint and configure the extension action to open the side panel.
3. Replace the hello-world popup path with the side panel workflow while keeping build/dev commands unchanged.
4. Implement demo orchestration in the background service worker.
5. Verify the side panel flow manually in the browser and with TypeScript/build checks.
6. Defer real content-script automation to a separate accepted change after this foundation is tested.

Rollback is simple at this stage: revert the side panel entrypoint/config changes and restore the previous popup entrypoint.

## Open Questions

- Should the first real automation round start with one app only, likely ChatGPT, before expanding to all six apps?
- Should Round 1 show the assembled judge prompt in the handoff state for debugging, or keep it hidden to match the final product?
- Should stored demo sessions be clearly marked so they can be filtered or cleared separately once real automation exists?
