# Single-surface multi-session sidebar

## Goal

Provide a Claude Code/Codex-like VS Code surface while preserving OMP's own TUI,
authentication, model discovery, extensions, skills, and session storage.

## User contract

- One VS Code window may run many OMP sessions concurrently.
- One sidebar owns home, new-chat composer, recent list, and selected conversation drill-in.
- Every live chat owns one OMP RPC process and one explicit working directory; normal chats create
  no editor panel.
- Writing sessions use distinct Git worktrees, enforced by atomic cross-process lease.
- Multiple sessions may share a directory only in read-only mode. Read-only sessions
  remove `bash`, `edit`, `write`, and `task` from OMP's enabled tool list.
- Loop controller session launches repository-owned `npm run omp:loop -- <alias>` profile
  and refuses an already-owned controller directory.
- Back or chat switching never terminates process. Explicit Close terminates only that chat.
- Source-file context routes to the active or explicitly selected OMP session.

## Architecture

```text
OMP Sessions activity view
  └─ SessionManager
      ├─ home/recent composer
      ├─ selected conversation presentation
      └─ background RPC hosts → independent OMP processes → independent worktrees
```

Selected-session router attaches shared webview only to one host. Switching chats rehydrates
history/runtime state and cannot cross-route prompts, approvals, or aborts. Background hosts keep
receiving and buffering RPC events while not selected.

`git worktree list --porcelain` is parsed without shell interpolation. Directory
selection is explicit and shown in the session tree tooltip. Relative file links are
resolved against the owning session's directory before workspace fallbacks.

Source-context commands compare shared Git identity, map repository-relative path
into target worktree, and require mapped file to exist. They never send
out-of-worktree absolute paths to writing session.

## Binary resolution

Resolution order:

1. selected worktree's `scripts/omp/launch.mjs`
2. `ohMyPiSessions.executablePath`
3. legacy `ohMyPi.executablePath`
4. platform locations, including `%LOCALAPPDATA%\omp\omp.exe` on Windows
5. `omp` from inherited `PATH`

An absolute executable is spawned directly; it is not routed through PowerShell.
This avoids stale VS Code `PATH` state after installing OMP.

## Scope

Included:

- concurrent background RPC sessions with one selected sidebar presentation;
- single-action active-session sidebar;
- picker-free current/dedicated-worktree default plus explicit advanced picker;
- atomic cross-process writer leases with stale-PID recovery;
- read-only brainstorming profile;
- conversation-triggered handoff to repository-owned Loop controller profile;
- same-repository source-path remapping;
- restart, search, rename, close, and source-context commands;
- automatic local OMP binary detection.

Deferred:

- restoring live PTYs after VS Code restarts;
- automatic cleanup of finished Git worktrees;
- inline source diffs beyond current expandable tool evidence;
- Loop-specific dispatch controls.

OMP remains source of truth for agent runtime. Rich presentation consumes OMP RPC and does not
reimplement agent behavior.

## Acceptance checks

- TypeScript strict check passes.
- Unit tests cover PTY spawning, Git worktree parsing, path remapping, and leases.
- Production extension bundle builds.
- VSIX packages without missing runtime assets.
- Installed extension opens two simultaneous chats bound to different directories without editor panels.
- Switching or backing out of one chat leaves every process running.
