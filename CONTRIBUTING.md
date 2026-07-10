# Contributing to AI Council

Thanks for your interest in improving AI Council. This project is open source under the [MIT License](./LICENSE).

## Ways to contribute

- Report bugs and rough edges (especially broken DOM selectors when AI sites change)
- Improve selectors under `config/selectors/`
- Add or fix app adapters under `entrypoints/` and `config/apps.json`
- Improve the side panel UX, docs, or accessibility
- Submit well-scoped pull requests

## Development setup

```bash
npm install
npm run compile
npm run dev:manual   # then Load unpacked → .output/chrome-mv3-dev
```

See [README.md](./README.md) and [INSTALL.md](./INSTALL.md) for more detail.

## Before you open a PR

1. Keep changes focused (one concern per PR when possible).
2. Run `npm run compile` and `npm run build`.
3. Manually smoke-test the flow you touched (at least one agent + judge if relevant).
4. Do not commit secrets (`.env`, API keys, session cookies).
5. Do not commit build output (`.output/`, `node_modules/`, release zips).

## Selector / automation changes

Third-party sites change often. When updating selectors:

- Prefer native CSS only (project convention).
- Note the site and approximate date you verified the selectors.
- Avoid brittle class-name chains when a stable attribute exists.

## Code of conduct

Be respectful. Harassment, spam, or bad-faith contributions will be removed and may lead to blocked interaction with the project.

## License of contributions

By submitting a contribution, you agree that your work is licensed under the same MIT License as this repository, and that you have the right to submit it.
