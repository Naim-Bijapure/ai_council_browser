# Security policy

## Supported versions

This project is a pre-1.0 open-source browser extension. Security fixes are applied on a best-effort basis to the latest `master` branch / latest GitHub Release.

## What this extension does (security-relevant)

- Runs entirely in the user’s browser (Manifest V3).
- Injects content scripts into configured AI chat sites to automate prompts.
- Stores preferences (`chrome.storage`) and local session history (IndexedDB).
- Does **not** intentionally send your prompts or history to an AI Council backend (there is none in this project).

Third-party AI sites you use still process data under **their** policies.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security-sensitive reports.

Instead, report privately via one of:

1. **GitHub Security Advisories** for this repository (preferred if enabled):  
   `https://github.com/Naim-Bijapure/ai-council/security/advisories/new`
2. Or email the maintainer using the address on the GitHub profile for [Naim-Bijapure](https://github.com/Naim-Bijapure).

Include:

- Description of the issue and impact
- Steps to reproduce
- Affected version / commit if known
- Any suggested fix

We will try to acknowledge reports within a reasonable time and coordinate disclosure after a fix is available when appropriate.

## Non-security bugs

Use normal GitHub Issues for crashes, selector breakage, and feature requests.
