# Oh My Pi Sessions

Run multiple independent [Oh My Pi](https://github.com/can1357/oh-my-pi)
sessions in one VS Code window. Each OMP process opens as a native editor tab and
has its own working directory, structured RPC state, and lifecycle.

## Why this fork exists

The upstream
[Oh My Pi for VS Code](https://github.com/shohihul/oh-my-pi-vscode) extension
provides one excellent embedded sidebar terminal. This fork adds a session manager
and structured RPC surface for parallel, worktree-heavy development. Original
xterm/PTTY surface remains as an explicitly selected diagnostic TUI.

The UX direction also draws from
[OMP Desktop](https://github.com/MTEnt/omp-desktop) and
[Zetaphor's Pi VS Code extension](https://github.com/Zetaphor/pi-vscode-extension):
the interface orchestrates sessions while OMP remains the agent runtime.

## Workflow

1. Open **OMP Sessions** from the activity bar.
2. Click **+** for work, **play** for a Loop controller, or lightbulb for read-only.
3. Pick current workspace or any existing Git worktree.
4. Work in the new `π …` editor tab with conversation, advisor, tool, retry,
   compaction, and subagent events rendered directly.
5. Repeat. Tabs run concurrently and may be moved into VS Code split groups.

One VS Code window can therefore contain:

- a Loop controller in its clean controller worktree;
- several implementation sessions in separate worker worktrees;
- a read-only architecture or brainstorming session;
- ordinary source editors alongside all of them.

For a repository exposing `scripts/omp/launch.mjs`, use **New Loop Controller**.
Pick a clean controller worktree and enter an alias. The extension starts the locked
RPC profile, checks exact runtime parity, then sends `/loop-start <alias>`.
Mismatched model, effort, cwd, or tool surface blocks the prompt before the
controller starts. A second writer cannot claim the same controller directory.

The rule is **one writing session per worktree**, not one VS Code window per
worktree. Atomic leases under shared Git directory enforce this across tabs,
windows, and extension-host restarts; stale process owners are recovered. If
directory is occupied, use read-only mode or focus/close existing owner.

## Read-only sessions

Read-only tabs start OMP with a restricted tool list:

```text
read, grep, glob, lsp, inspect_image, browser, web_search, todo
```

No `bash`, `edit`, `write`, or `task` tool is enabled. This makes sharing a source
directory suitable for ideation and review without creating another Git writer.

Editor context commands never send absolute path from another checkout.
Same-repository files are remapped by repository-relative path into selected
session worktree; missing or unrelated targets are refused.

## OMP executable

Windows installation at `%LOCALAPPDATA%\omp\omp.exe` is detected automatically,
even when VS Code was opened before the installer changed `PATH`.

Selected worktree wins over lobby workspace: when
`scripts/omp/launch.mjs` exists, tab starts repository-owned launcher from that
worktree. Read-only tab adds repository's `--read-only` profile.

Manual override:

```json
{
  "ohMyPiSessions.executablePath": "C:\\path\\to\\omp.exe",
  "ohMyPiSessions.defaultArguments": ["--advisor", "--thinking=max"]
}
```

The original extension's `ohMyPi.executablePath` setting is also read as a migration
fallback.

## RPC parity and capabilities

OMP remains the runtime and authority. The extension does not replace its model
routing, advisor, skills, tools, session storage, or Loop controller. It negotiates
RPC protocol v2 and renders:

- streaming messages and thinking;
- live tool calls and results;
- advisor interventions;
- retries, compaction, TTSR, todos, and subagent progress;
- slash-command discovery;
- send, steer, follow-up, and abort;
- OMP extension confirmations, selections, and editor input;
- model, effort, context, queue, worktree, and parity state.

The Dzialkopedia launcher pins Opus 5/max as controller, keeps Sol 5.6/xhigh
advisor configuration, and exposes Loop-only tools only in Loop mode. Exact
runtime tool inventory must match, and every profile requires a project-policy
marker tool, before any prompt is accepted. Repository launcher discovery also
requires the canonical Dzialkopedia Git origin and byte equality for every
launch-critical adapter file against canonical GitHub `main`. Private-repository
verification uses authenticated GitHub CLI (`gh auth status`) and fails closed when
canonical tree hashes cannot be loaded. The immutable canonical preflight blob must
also declare exactly the same duplicate-free adapter inventory pinned by the extension,
so a new executable dependency cannot bypass validation. See the
[RPC cutover contract](docs/rpc-cutover.md).

**OMP Sessions: Open Diagnostic TUI Session** starts the real terminal surface
only when explicitly requested. Under trusted Dzialkopedia policy it uses the
read-only profile. In a generic folder, where OMP extension/MCP mounts cannot be
proven read-only, it acquires the normal writer lease. Generic structured read-only
sessions fail closed without a trusted project policy launcher. No automatic fallback
and no shadow process exist.

## Commands

- `OMP Sessions: New Work Session`
- `OMP Sessions: Open Diagnostic TUI Session`
- `OMP Sessions: New Read-Only Session`
- `OMP Sessions: New Loop Controller`
- `OMP Sessions: Open Active Session`
- `OMP Sessions: Restart Session`
- `OMP Sessions: Rename Session`
- `OMP Sessions: Close Session`
- `OMP Sessions: Show Logs`
- `OMP Sessions: Send Line Reference to OMP`
- `OMP Sessions: Send Selection to OMP`
- `OMP Sessions: Send File Path to OMP`

Default shortcut for a new work session:

- Windows/Linux: `Ctrl+Shift+Alt+I`
- macOS: `Cmd+Shift+Alt+I`

## Build and install

```bash
npm install
npm run typecheck
npm test
npm run build
npm run package
code --install-extension oh-my-pi-vscode-sessions-2.0.0.vsix --force
```

## Current boundary

Tabs are native VS Code webview panels connected to real OMP RPC processes.
Processes live concurrently while the window is open. Closing a tab or deactivating
the extension terminates its full process tree and waits for reaping before releasing its
worktree writer lease;
OMP's session file remains available for restart and resume. Repository root,
nested-folder, and junction selections share one canonical lease identity.

Generic filesystem rollback/checkpoints are intentionally excluded: under parallel
worktrees they can revert unrelated work. OMP custom TUI-only components are not
fabricated; use the explicit diagnostic TUI when investigating one.

## License

MIT. Original extension copyright and license remain in [LICENSE](LICENSE).
