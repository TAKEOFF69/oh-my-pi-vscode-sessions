# Contributing

Contributions are welcome for Oh My Pi RPC compatibility, multi-session behavior, VS Code UX,
process lifecycle, worktree safety, accessibility, and documentation.

## Development setup

Requirements:

- Node.js 22;
- VS Code 1.85 or newer;
- current Oh My Pi for live integration testing;
- Python plus Playwright only for browser-render verification.

```bash
npm ci
npm run typecheck
npm test
npm run build
npx vsce ls
```

For UI changes, install Playwright's Chromium runtime and run:

```bash
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
python scripts/verify-webview.py
```

## Pull requests

1. Open a focused branch from current `main`.
2. Add or update a regression test for behavior changes.
3. Run typecheck, tests, production build, and packaging inventory.
4. Describe user-visible behavior and any security or compatibility boundary changed.
5. Keep generated bundles and `.vsix` files out of commits.

Changes to process spawning, executable resolution, URI handling, webview rendering, writer leases,
Git worktrees, RPC framing, or project-policy validation require explicit RED/GREEN regression
coverage.

## Generic core and project policies

Generic session management must remain usable without any private repository or project adapter.
Do not place credentials, local absolute paths, private source, customer data, or provider tokens in
fixtures or documentation.

Project-specific behavior must remain fail-closed and activate only after explicit repository
identity and policy validation. See [project policy boundary](docs/project-policy-boundary.md).

## Commit and review expectations

- Prefer small, reviewable changes.
- Preserve MIT attribution inherited from the original extension.
- Do not weaken security checks merely to make a fixture pass.
- Report security defects privately according to [SECURITY.md](SECURITY.md).
