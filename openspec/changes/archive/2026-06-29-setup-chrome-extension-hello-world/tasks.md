## 1. Project Scaffold

- [x] 1.1 Create `package.json` with WXT, React, TypeScript, and npm scripts for `dev`, `build`, `compile`, and `zip`.
- [x] 1.2 Add TypeScript configuration compatible with WXT and React JSX.
- [x] 1.3 Add WXT configuration for a Chrome Manifest V3 extension with the React module, basic name, description, version, and action popup metadata.
- [x] 1.4 Add repository ignore rules for dependencies, generated extension output, logs, and local environment files.

## 2. Extension Entrypoints

- [x] 2.1 Create a minimal React popup entrypoint with `main.tsx`, `App.tsx`, and CSS.
- [x] 2.2 Render a simple hello-world confirmation through React without user input or remote data.
- [x] 2.3 Create a minimal background service worker entrypoint that initializes without runtime errors.
- [x] 2.4 Keep initial manifest permissions and host permissions empty.

## 3. Documentation

- [x] 3.1 Add README setup instructions for dependency install, development mode, type checking, production build, and packaging.
- [x] 3.2 Document the Chrome load-unpacked flow using the generated `.output/chrome-mv3` directory.
- [x] 3.3 Document the intended source layout so future React UI entrypoints, background, content-script, options, and shared modules have clear homes.

## 4. Verification

- [x] 4.1 Install dependencies and commit the generated lockfile.
- [x] 4.2 Run TypeScript/WXT compile checks.
- [x] 4.3 Run the production build and verify `.output/chrome-mv3/manifest.json` uses Manifest V3.
- [x] 4.4 Run the package script and verify a distributable extension archive is produced.
