## Context

This repository currently contains OpenSpec planning files but no extension source code. The requested first step is a minimal Chrome extension foundation using TypeScript and current extension development practices, with room to add real features later.

Current guidance checked on 2026-06-29:
- Chrome extension work should use Manifest V3 for new development.
- Manifest V3 background logic runs in extension service workers instead of persistent background pages.
- Chrome Web Store Manifest V3 policy expects extension logic to be self-contained in the submitted package and not executed from remote sources.
- WXT currently documents v0.20.27 and provides a modern TypeScript-friendly extension framework using Vite, entrypoint-based builds, generated manifests, and browser extension conventions.
- WXT documents an official React module for React-based extension UI entrypoints.

## Goals / Non-Goals

**Goals:**

- Create a small TypeScript Chrome extension architecture.
- Use WXT as the extension framework and Vite-powered build layer.
- Use React for extension UI surfaces from the start.
- Generate Manifest V3 output through `wxt.config.ts` instead of maintaining a raw source `manifest.json`.
- Add a React popup entrypoint that displays a simple hello-world screen.
- Add a minimal background service worker entrypoint for future event-driven behavior.
- Keep initial permissions empty unless a feature requires them.
- Add common scripts for development, build, type checking, and packaging.
- Document how to load the built extension locally in Chrome.

**Non-Goals:**

- No AI, counseling, authentication, storage, content script, side panel, options page, remote API, analytics, or browser sync feature in this change.
- No Chrome Web Store publishing flow beyond producing a package-ready build.
- No cross-browser support work beyond choosing WXT so it remains feasible later.
- No complex component library, global state library, router, or design system in this change.

## Decisions

1. Use WXT with TypeScript for the extension scaffold.
   - Rationale: WXT provides extension-aware entrypoints, manifest generation, TypeScript integration, Vite tooling, dev mode, and packaging commands with less custom glue than plain Vite.
   - Alternative considered: Plain Manifest V3 files plus TypeScript build scripts. This is simpler at first, but it creates more manual manifest/build wiring as soon as background, popup, content scripts, and shared modules are added.
   - Alternative considered: Plasmo. It is also modern, but WXT is smaller, closer to browser extension primitives, and a good fit for a simple foundation.

2. Use React for the popup UI.
   - Rationale: The extension is expected to grow, and React gives future popup/options/side-panel UI a familiar component model from the first commit. WXT supports React through an official module, so adding it now keeps the setup conventional instead of bolting it on later.
   - Alternative considered: Framework-free popup. This is lighter for a pure hello-world screen, but it would likely be replaced once real UI state, settings, or multi-view controls are added.
   - Alternative considered: Vue or Svelte. Both can work with WXT, but React has the broadest ecosystem and is a safe default for future extension UI work.

3. Use WXT entrypoints as the main source layout.
   - Rationale: `entrypoints/popup/` and `entrypoints/background.ts` match WXT conventions and scale naturally when content scripts, options pages, side panels, or offscreen documents are introduced. The popup can contain React files such as `App.tsx` and `main.tsx` without changing the extension-level layout.
   - Alternative considered: A custom `src/` layout with hand-managed bundler entries. This adds unnecessary configuration for the first version.

4. Generate the Manifest V3 file from `wxt.config.ts`.
   - Rationale: WXT produces `.output/{target}/manifest.json` at build time and allows manifest fields to live beside other extension configuration.
   - Alternative considered: Commit a static `manifest.json`. Static manifests are clear, but duplicate framework-managed metadata and make target-specific builds harder later.

5. Start with no declared permissions.
   - Rationale: The hello-world popup does not need extension API permissions or host access. Keeping permissions empty reduces user warnings and establishes a least-privilege baseline.
   - Alternative considered: Add `activeTab`, `storage`, or host permissions preemptively. These should be introduced only with features that need them.

## Risks / Trade-offs

- [Risk] WXT adds a framework dependency for a tiny extension. -> Mitigation: Keep the source structure minimal and use WXT only for entrypoints, manifest generation, dev/build, and packaging.
- [Risk] React adds dependency weight for a hello-world popup. -> Mitigation: Keep React usage limited to UI entrypoints and avoid extra UI/state libraries until a feature needs them.
- [Risk] Manifest generation may hide the final Chrome manifest from beginners. -> Mitigation: Document that the generated manifest is emitted under `.output/chrome-mv3/manifest.json` after build.
- [Risk] Package-manager network access may be unavailable during implementation. -> Mitigation: Prefer standard npm scripts and verify locally once dependencies are installed.

## Migration Plan

1. Add the Node package scaffold and WXT/TypeScript/React configuration.
2. Add popup and background entrypoints.
3. Add docs for install, development, build, package, and load-unpacked flow.
4. Install dependencies.
5. Run type checking and production build.
6. Load `.output/chrome-mv3` in Chrome developer mode for manual verification.

Rollback is straightforward because this change only adds initial project files. Remove the scaffolded files if the chosen tooling needs to be replaced before feature work begins.

## Open Questions

- Should the extension target Chrome only long term, or should the architecture keep Firefox/Edge packaging in scope after the first Chrome version?
