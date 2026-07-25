# Oh My Pi Sessions

Run multiple independent [Oh My Pi](https://github.com/can1357/oh-my-pi)
sessions in one VS Code window. Each OMP process opens as a native editor tab and
has its own working directory, terminal state, and lifecycle.

## Why this fork exists

The upstream
[Oh My Pi for VS Code](https://github.com/shohihul/oh-my-pi-vscode) extension
provides one excellent embedded sidebar terminal. This fork keeps its xterm/PTTY
foundation and adds a session manager for parallel, worktree-heavy development.

The UX direction also draws from
[OMP Desktop](https://github.com/MTEnt/omp-desktop) and
[Zetaphor's Pi VS Code extension](https://github.com/Zetaphor/pi-vscode-extension):
the interface orchestrates sessions while OMP remains the agent runtime.

## Workflow

1. Open **OMP Sessions** from the activity bar.
2. Click **+** for work, **play** for a Loop controller, or lightbulb for read-only.
3. Pick current workspace or any existing Git worktree.
4. Work in the new `π …` editor tab.
5. Repeat. Tabs run concurrently and may be moved into VS Code split groups.

One VS Code window can therefore contain:

- a Loop controller in its clean controller worktree;
- several implementation sessions in separate worker worktrees;
- a read-only architecture or brainstorming session;
- ordinary source editors alongside all of them.

For a repository exposing `npm run omp:loop -- <alias>`, use **New Loop
Controller**. Pick clean controller worktree and enter alias. Tab launches repository's
locked Loop profile directly; second writer cannot claim same controller directory.

The rule is **one writing session per worktree**, not one VS Code window per
worktree. Atomic leases under shared Git directory enforce this across tabs,
windows, and extension-host restarts; stale process owners are recovered. If
directory is occupied, use read-only mode or focus/close existing owner.

## Read-only sessions

Read-only tabs start OMP with a restricted tool list:

```text
read, grep, glob, lsp, inspect_image, browser, web_search, ask, todo
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

## Commands

- `OMP Sessions: New Work Session`
- `OMP Sessions: New Read-Only Session`
- `OMP Sessions: New Loop Controller`
- `OMP Sessions: Open Active Session`
- `OMP Sessions: Restart Session`
- `OMP Sessions: Rename Session`
- `OMP Sessions: Close Session`
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
code --install-extension oh-my-pi-vscode-sessions-1.2.0.vsix
```

## Current boundary

Tabs are native VS Code webview panels containing OMP's real TUI. Processes live
concurrently while the window is open. Closing VS Code terminates the PTYs; OMP's
saved sessions remain available through its normal `--continue` and `--resume`
commands.

Rich RPC tool cards, checkpoints, and inline diff widgets are possible later, but
are intentionally outside this first reliable multi-session layer.

## License

MIT. Original extension copyright and license remain in [LICENSE](LICENSE).
