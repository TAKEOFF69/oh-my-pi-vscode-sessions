# Changelog

All notable changes to **Oh My Pi for VS Code** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-07-28

### Changed

- Sidebar now exposes one primary **New Session** action. Specialized profiles no
  longer compete as startup buttons.
- Normal Dzialkopedia session can request isolated Loop controller during conversation
  through validated `loop_handoff` result.
- Every **New Session** click provisions fresh canonical isolated Dzialkopedia
  worktree through extension-owned Git operations instead of executing local
  repository lifecycle scripts or reopening worktree picker.
- Loop aliases remain immutable across dynamic title changes, and same-alias
  handoffs are serialized to one controller.
- Read-only, diagnostic TUI, manual Loop, and chosen-worktree launches remain advanced
  Command Palette operations.
- Normal session labels no longer present internal Work mode as user-facing choice.

## [2.0.1] - 2026-07-28

### Fixed

- Standard session buttons now open immediately in current workspace or dedicated
  Dzialkopedia OMP worktree instead of always showing worktree picker.
- Shared or stale Dzialkopedia `main` is never selected as automatic session target.
- Work, read-only, and Loop defaults resolve independently while preserving one-writer
  lease contract.
- Advanced `New Work Session in Chosen Worktree…` command retains explicit selection
  for parallel feature work.

## [2.0.0] - 2026-07-27

### Added

- Structured OMP RPC sessions as the default native editor-tab surface.
- Protocol-v2 negotiation, bounded JSONL/chunk decoder, correlated requests, and
  process-tree lifecycle management.
- Conversation, thinking, advisor, tool, retry, compaction, TTSR, todo, subagent,
  command, and extension-request presentation.
- Send, steer, follow-up, abort, file/URL handoff, history hydration, and runtime
  state rail.
- Fail-closed Dzialkopedia parity profiles for model, effort, worktree launch,
  exact allowed tools, forbidden tools, and project-policy presence.
- Bounded paged history hydration, late prompt-failure draft restoration, and
  pre-parity extension-UI cancellation.
- Explicit **Open Diagnostic TUI Session** command; no automatic terminal fallback.
- Seeded parity selftest, fake RPC lifecycle integration test, and desktop/narrow
  Playwright webview verification.

### Changed

- Repository Loop sessions start RPC first, validate parity, then dispatch
  `/loop-start <alias>` through the host.
- Worktree writer leases now cover both structured RPC and diagnostic TUI sessions.
- Writer leases bind canonical repository roots across nested paths and junctions,
  and release only after the OMP process tree is reaped.
- Dzialkopedia launcher discovery now requires its canonical Git origin and
  byte-equivalence for the full canonical GitHub `main` adapter inventory before
  local launcher execution, using authenticated pinned-host GitHub tree hashes plus
  exact set equality with the immutable canonical preflight declaration.
- Diagnostic TUI is read-only only under trusted project policy; generic diagnostic
  TUI acquires a writer lease and generic read-only RPC fails closed. Extension
  deactivation now awaits full Windows process-tree or Unix process-group reaping
  before releasing writer leases.

## [1.2.1] - 2026-07-26

### Added

- Session lifecycle state in activity-bar roster: starting, running, finished, or failed.
- Persistent **OMP Sessions: Show Logs** output with activation, worktree, launcher, PTY, and exit diagnostics.

### Fixed

- Failed or slow project launchers no longer look like inactive session tabs; state and diagnostic path remain visible.

## [1.2.0] - 2026-07-26

### Added

- Forked as **Oh My Pi Sessions**.
- Concurrent native VS Code editor tabs, each owning one PTY and OMP process.
- Existing-Git-worktree picker with cwd and branch identity per session.
- Atomic cross-window write-owner leases with read-only/focus recovery.
- Read-only brainstorming sessions without Bash or mutation tools.
- Windows OMP executable auto-detection for stale VS Code PATH state.
- Active-session list with focus, rename, restart, close, and source-context actions.
- Loop controller tabs that invoke repository-owned `npm run omp:loop -- <alias>` safely.
- Source context remapping into selected worktree; unrelated or missing targets are refused.
- Per-worktree project-launcher detection, independent of lobby workspace settings.

## [1.1.0] - 2026-07-14

### Added

- **Find in Terminal** — search the terminal scrollback with a webview search bar: type-ahead matching, next/previous navigation (`Enter` / `Shift+Enter`), and a live match counter (`N/M`). Toggles for **Match Case**, **Match Whole Word**, and **Regular Expression**.
- Match highlighting and the active-result counter powered by `@xterm/addon-search`, with colors resolved live from the active VS Code theme (`--vscode-editor-findMatch*` variables).
- Open search via `Cmd/Ctrl+F` (intercepted inside the terminal so the keystroke never leaks to the shell), the **Find in Terminal** command, the search toolbar icon, or the command palette. Close with `Escape`.
- **Send Line(s) to omp** — sends a line reference to the embedded terminal and presses Enter: `path/to/file:42` for a single line, or `path/to/file:20-25` for a selection. Paths are relative to the workspace and line numbers match the editor.
- **Send Selection to omp** — sends the exact selected text (or the active line if nothing is selected) to the terminal, with no trailing newline.
- **Send File Path to omp** — sends the file path relative to the workspace and presses Enter.
- All three are reachable from the editor right-click menu and the Command Palette.
- Clickable links in terminal output — URLs are detected automatically by the `WebLinksAddon` and open in the system browser on click.
- Clickable file paths in terminal output — absolute paths (`/usr/src/app.ts`), home paths (`~/config.json`), relative paths (`./src/foo.ts`, `src/foo.ts`, `../lib/bar.js`), and Windows drive paths (`C:\Users\file.ts`) are detected and open in the editor on click, with optional `:line` or `:line:col` suffix support for cursor positioning.

### Fixed

- `Shift+Enter` now inserts a newline in the `omp` composer instead of submitting the message. xterm.js hardcodes the Enter key to a bare carriage return and ignores the Shift modifier, so both Enter and Shift+Enter arrived identically and were read as "submit". Shift+Enter is now intercepted in the webview (where the Shift modifier is still visible) and re-injected as the legacy `ESC [ 13 ; 2 ~` sequence that `omp` maps to "insert newline".

## [1.0.1] - 2026-07-11

### Fixed

- Double-paste when using `Cmd/Ctrl+V` — removed a redundant document-level keyboard paste handler that was duplicating xterm.js's built-in native paste handling.

## [1.0.0] - 2026-07-11

First stable release.

### Added

- Embedded terminal panel in a dedicated activity-bar sidebar running `omp` via a real pseudo-terminal (PTY).
- xterm.js rendering with optional WebGL acceleration.
- Terminal colors read live from the active VS Code theme via `--vscode-terminal-*` CSS variables; update automatically when the theme changes.
- Font family and size inherit from `terminal.integrated.fontFamily` / `terminal.integrated.fontSize`.
- Commands: **Open Terminal** (`Cmd/Ctrl+Shift+Alt+I`) and **Restart Terminal**.
- Settings: `ohMyPi.executablePath`, `ohMyPi.autoStart`, `ohMyPi.workingDirectory`.
- `omp` launched through a login shell on macOS/Linux and PowerShell on Windows so shell profile PATH is respected.
- Auto-restart on exit (press any key); automatic restart when `executablePath` or `workingDirectory` changes.
- Paste via `Cmd/Ctrl+V` or middle-click.
- Cross-platform prebuilt native binaries for macOS, Linux, and Windows (x64 + arm64).

[1.1.0]: https://github.com/shohihul/oh-my-pi-vscode/releases/tag/v1.1.0

[1.0.0]: https://github.com/shohihul/oh-my-pi-vscode/releases/tag/v1.0.0
