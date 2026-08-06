# Changelog

All notable changes to **Oh My Pi for VS Code** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.6.2] - 2026-08-06

### Added

- Exact Dzialkopedia work sessions now show a quiet waiting signal after 12 seconds without model
  output and stop the stalled turn after 20 seconds with one explicit `Retry now` action.

### Fixed

- Anthropic overload no longer leaves the sidebar inside OMP's nested minute-long automatic retry
  sequence or dumps raw retry and abort transport messages into the conversation.
- Retrying a stopped turn preserves its text and attached screenshots while keeping Opus 5 locked;
  no fallback model or credential substitution is introduced.

## [2.6.1] - 2026-08-05

### Fixed

- Writer leases use immutable per-session tokens, preventing simultaneous stale reclaimers from
  deleting a newly acquired lease or both taking ownership of one worktree.
- Crash-left token leases are reclaimed without a shared recovery mutex that can itself become
  orphaned; legacy 2.6 mutable leases remain fail-closed during the upgrade boundary.
- Missing, unreadable, malformed, or token-mismatched lease inventory now blocks acquisition
  instead of being mistaken for an unowned worktree.

## [2.6.0] - 2026-08-05

### Added

- Durable first-prompt drafts, including bounded screenshots, survive extension-host reload and
  clear only after OMP accepts ownership.
- Chat rows and selected-chat header expose restart/close controls; dormant missing sessions are
  pruned and removable without deleting repository files.
- Live advisor identity is checked through OMP before first prompt and after completed turns.
- Clipboard paste accepts Windows screenshot data exposed through either clipboard items or files.

### Fixed

- Terminal-answer watchdog recovers OMP RPC sessions that remain incorrectly marked streaming,
  with one bounded abort and no timeout for active tools or legitimate long turns.
- Ambient MCP mounts, unexpected native approvals, stale extension-host versions, missing session
  files, unsafe file links, and low-signal `TL;DR` titles now fail closed or stay out of chat.
- Fresh Dzialkopedia sessions reuse a short-lived exact fetch receipt, avoiding duplicate startup
  fetch while preserving canonical `origin/main` proof.
- Pristine extension-created worktrees are removed through repository cleanup when startup never
  becomes durable; two-phase ownership and atomic writer leases preserve active, ambiguous, or
  changed worktrees, and close/restart cannot outrun first-prompt acceptance.
- Advisor probes are generation-bound and single-flight, user prompts wait for an active probe,
  draft writes flush on shutdown, and abandoned unused worktrees recover only after exact marker
  ownership and absence of a live writer lease are proved.

### Changed

- Live RPC processes are capped at six. Oldest unselected persisted idle chat may suspend and
  remains resumable; active, running, or unpersisted chats are never evicted.
- Dzialkopedia requires OMP 17.2.9 and explicit ambient-provider/MCP isolation.

## [2.5.2] - 2026-08-05

### Fixed

- Hidden OMP `xdev-mount-notice` messages stay out of chat and failed internal activity remains
  collapsed with a visible failure count.
- Verified Dzialkopedia sessions fail closed if OMP unexpectedly requests native tool approval;
  generic profiles no longer inherit the trusted `Full access` label.

### Security

- Added private vulnerability reporting policy, CodeQL workflow, production dependency audit, and
  executable XSS regression for untrusted OMP Markdown.

### Changed

- Added contributor, support, privacy, issue, pull-request, ownership, and dependency-update
  metadata for public beta development.
- Documented exact generic-core versus built-in project-policy boundary without claiming adapter
  package separation that does not yet exist.
- CI can run manually and verifies RPC parity plus native package creation on Windows, macOS,
  and Linux.

## [2.5.1] - 2026-08-05

### Added

- Paste screenshots directly into both new-chat and active-chat composers. Images are previewed,
  removable, resized within OMP's unchunked RPC input budget, and restored with failed drafts.

### Fixed

- Dzialkopedia work-session parity now includes the repository-owned `blackbull_codex` tool while
  keeping it absent from read-only and Loop profiles.
- Stale Dzialkopedia adapter failures now explain that a fresh New Chat is the recovery path.

## [2.5.0] - 2026-08-05

### Changed

- Conversation view now presents one final answer per user turn and folds reasoning, advisor,
  successful tool activity, runtime metadata, and subagent progress into one closed activity row.
- Dzialkopedia canonical adapter inventory includes first-class BlackBull Luna/max transport.

### Fixed

- Hidden and synthetic runtime messages no longer replace user-visible answers.
- Transient history paging `session_busy` responses no longer appear as chat errors.
- Repeated Assistant/model headers and duplicated inline tool-call cards are removed from the
  default reading flow; failed tools, parity failures, and operator requests remain visible.

## [2.4.0] - 2026-08-04

### Changed

- Chat list, prompt-first new chat, and selected conversation now occupy one Codex-style sidebar;
  normal RPC chats no longer create editor panels.
- Normal sessions in every project lock Claude Opus 5 Extra High as driver and GPT-5.6 Sol Extra
  High as advisor, with model fallback disabled and runtime driver parity checked before prompting.
- Git projects receive fresh writer worktree per normal chat; non-Git folders keep direct local use.

### Fixed

- Back and chat switching detach only presentation, preserving independently running OMP sessions.
- Prompts, approvals, and aborts route exclusively to selected chat even when request IDs overlap.
- Generic projects no longer inherit OMP's Opus 4.8/high defaults.

## [2.3.0] - 2026-08-03

### Added

- Codex-style Chats sidebar with recent sessions, one bottom-docked composer, and prompt-first
  session creation. Opening or focusing the view never launches OMP by itself.
- Prompt-derived session titles with persisted OMP names, manual-rename precedence, and exact
  worktree/session-file resume for bounded recent history.

### Changed

- Dzialkopedia parity now requires Opus 5 at Extra High effort as primary driver and displays the
  GPT-5.6 Sol Extra High advisor explicitly.
- Successful preflight detail stays in the output channel so a new chat opens on conversation,
  while blocking diagnostics remain visible in the session.

### Fixed

- First prompt is delivered exactly once after isolated-worktree provisioning and parity succeeds.
- Sidebar submission is creation-guarded; failures restore the exact draft instead of spawning
  repeated sessions.

## [2.2.2] - 2026-08-02

### Changed

- Canonical Dzialkopedia adapter inventory now pins Loop creator mechanical-preflight executable,
  config contract, canonical worktree launch/cleanup scripts, npm script/lock bytes, and Git hook
  entrypoints plus their executable gate closure, including worker output redaction. New sessions
  fail closed unless extension and repository agree on complete status-only OMP harness-preflight
  integration and final-consumer bytes.

## [2.2.1] - 2026-08-02

### Fixed

- Composer Send control now enables immediately after typed or programmatic draft changes and
  disables again after submission. Startup drafts remain intact until transport and parity are
  ready, including host-side race rejection.
- Generic sessions without exact parity now say `Custom access`; `Full access` is reserved for a
  passed work-session parity contract.
- Live output updates only changed message nodes, preserving expanded tool evidence and avoiding
  full-history Markdown/DOM rebuilds on every streamed frame.
- Active OMP input/editor requests retain operator text and focus across unrelated runtime frames.
- Browser proof now clicks Send and verifies exact prompt delivery in desktop, narrow, and empty
  session layouts, plus startup-draft, request-preservation, and long-history streaming checks.

## [2.2.0] - 2026-08-02

### Changed

- Structured RPC tabs now use Codex-like quiet chrome: flat canvas, compact session header,
  text-first conversation, expandable tool rows, bottom-docked rounded composer, and local
  worktree footer.
- Composer shows real OMP access mode, model, effort, queue state, and send/stop state without a
  persistent technical status rail.
- Header opens native OMP Sessions, extension settings, and duplicate-gated New Session. Plus menu
  keeps find, logs, and diagnostic terminal available without crowding normal work.

### Fixed

- Webview root now owns full viewport height, preventing populated narrow sessions from clipping
  composer controls below editor viewport.
- Browser proof now covers populated desktop, populated `430x800`, and empty screenshot-like
  `457x1000` layouts, including composer bottom bounds.

## [2.1.3] - 2026-07-30

### Security

- Canonical Dzialkopedia adapter validation now pins the Windows Job Object
  launcher used by OMP preflight. Timed probes start suspended, enter a
  `KILL_ON_JOB_CLOSE` job before execution, and cannot leave detached descendants
  behind when a root process exits or times out.

## [2.1.2] - 2026-07-30

### Performance

- Fresh Dzialkopedia worktree checkout uses four bounded Git checkout workers.
  Measured repository checkout fell from 25.5 seconds to 7.6–9.8 seconds on the
  target Windows workstation without changing branch, SHA, cleanliness, or
  canonical-adapter validation.
- Repository identity and worktree discovery now overlap, including multi-root
  workspace discovery.
- RPC startup logs separate transport, parity, and fully-ready timings so future
  slow boots can be attributed without opening or terminating editor processes.

## [2.1.1] - 2026-07-30

### Fixed

- Dzialkopedia project launcher now resolves real Node.js from `PATH` instead of
  accidentally treating VS Code's extension-host executable as Node.
- Spawn boundary rejects VS Code, VSCodium, and Electron executables before process
  creation, including aliases nested in shell strings. `executablePath` now accepts
  one executable only; flags belong in `defaultArguments`. This prevents OMP teardown
  from targeting editor process trees.
- Re-entrant ordinary session entry points share one in-flight creation and are
  suppressed briefly after completion, preventing runaway worktree/session creation
  from New Session, Open, auto-start, or source-context commands.
- Canonical adapter verification warms concurrently with worktree preparation and is
  single-flight cached for five minutes. Provisioning also removes one redundant
  remote branch lookup and logs phase timings.
- Worktree bootstrap copies only missing local environment files and never overwrites
  canonical tracked files such as `.env.example`.

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
