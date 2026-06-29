## Why

The repository needs a small, modern Chrome extension foundation before feature work starts. Establishing the architecture now keeps the first implementation simple while giving later popup, background, content-script, storage, and permissions work a clear place to grow.

## What Changes

- Add a basic Chrome extension project scaffold using TypeScript.
- Use Manifest V3 as the extension platform baseline.
- Use WXT on top of Vite for extension-aware development, builds, entrypoints, and manifest generation.
- Use React for extension UI entrypoints, starting with the popup.
- Add a simple React "Hello World" popup experience as the first visible behavior.
- Include minimal background service worker structure for future extension events.
- Keep permissions minimal for the initial version.
- Add local development, build, type-check, and packaging scripts.
- Add basic project documentation for loading the unpacked extension in Chrome.

## Capabilities

### New Capabilities

- `chrome-extension-foundation`: Covers the project scaffold, extension manifest behavior, developer scripts, React popup hello-world behavior, and baseline architecture for future Chrome extension features.

### Modified Capabilities

- None.

## Impact

- Adds Node/TypeScript project files and extension source files.
- Adds WXT, React, Vite-powered build tooling, TypeScript, and linting/formatting-friendly project structure.
- Produces a Chrome-loadable extension build output.
- No external APIs, backend services, or user data storage are introduced in this change.
