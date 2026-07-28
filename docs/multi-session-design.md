# Native multi-session editor tabs

## Goal

Provide a Claude Code/Codex-like VS Code surface while preserving OMP's own TUI,
authentication, model discovery, extensions, skills, and session storage.

## User contract

- One VS Code window may run many OMP sessions concurrently.
- Every editor tab owns one PTY, one OMP process, and one explicit working directory.
- Writing sessions use distinct Git worktrees, enforced by atomic cross-process lease.
- Multiple sessions may share a directory only in read-only mode. Read-only sessions
  remove `bash`, `edit`, `write`, and `task` from OMP's enabled tool list.
- Loop controller session launches repository-owned `npm run omp:loop -- <alias>` profile
  and refuses an already-owned controller directory.
- Closing a tab terminates only that tab's OMP process.
- Source-file context routes to the active or explicitly selected OMP session.

## Architecture

```text
OMP Sessions activity view
  └─ SessionManager
      ├─ π main            → WebviewPanel → xterm → PTY → omp (repo root)
      ├─ π wip/checkout    → WebviewPanel → xterm → PTY → omp (worktree A)
      └─ π architecture    → WebviewPanel → xterm → PTY → omp (read-only)
```

VS Code supplies native editor tabs and tab groups. The extension does not emulate
tabs inside one webview. This keeps focus, rearranging, split groups, and tab closure
consistent with other editor surfaces.

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

- concurrent native editor tabs;
- active-session sidebar;
- picker-free current/dedicated-worktree default plus explicit advanced picker;
- atomic cross-process writer leases with stale-PID recovery;
- read-only brainstorming profile;
- repository-owned Loop controller profile;
- same-repository source-path remapping;
- restart, search, rename, close, and source-context commands;
- automatic local OMP binary detection.

Deferred:

- restoring live PTYs after VS Code restarts;
- creating or deleting Git worktrees;
- RPC-native rich tool cards and inline diffs;
- Loop-specific dispatch controls.

OMP remains source of truth for agent runtime. A future rich UI should use OMP's RPC
mode rather than reimplementing agent behavior.

## Acceptance checks

- TypeScript strict check passes.
- Unit tests cover PTY spawning, Git worktree parsing, path remapping, and leases.
- Production extension bundle builds.
- VSIX packages without missing runtime assets.
- Installed extension opens two simultaneous tabs bound to different directories.
- Closing one tab leaves the other process running.
