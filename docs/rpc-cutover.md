# RPC-native editor cutover

## Outcome

Make OMP RPC mode the default session surface while keeping OMP itself as the only agent
runtime. The extension renders structured OMP events; it does not reimplement planning,
tools, skills, advisor behavior, model routing, session storage, or Loop authority.

One editor tab still owns:

- one OMP process;
- one OMP session;
- one selected folder or Git worktree;
- one cross-process writer lease when the session may mutate files.

The legacy xterm surface remains available only through an explicitly named diagnostic
command. It is never an automatic fallback and never runs beside an RPC session.

## UX direction

The editor tab is an operational flight recorder rather than a generic chat page:

- compact run rail for model, effort, worktree, context, queue, and advisor lock;
- readable conversation stream with restrained user/assistant separation;
- collapsible thinking and tool execution cards;
- native prompt composer with send, steer, follow-up, and abort;
- inline OMP notices, retries, compaction, TTSR, and subagent progress;
- request cards for OMP extension confirmations, selections, and text/editor input;
- direct file and URL handoff to VS Code;
- visible transport and parity failures with no terminal fallback.

The surface follows VS Code theme variables and editor typography. Amber is reserved for
active execution and intervention; red is reserved for real failures.

## Runtime architecture

```text
SessionManager
  -> SessionPanel (native WebviewPanel)
     -> RpcSessionHost
        -> RpcProcess (stdio JSONL, protocol v2)
           -> repository launcher --rpc
              -> exact OMP runtime + project extension
```

`RpcProcess` owns:

- full process-tree lifecycle (Windows tree kill; Unix detached process groups);
- strict newline framing;
- protocol-v2 negotiation and bounded chunk reassembly;
- request/response correlation by id;
- stderr diagnostics without mixing them into protocol stdout;
- deterministic rejection of pending requests on exit.

`RpcSessionHost` owns:

- initial state/history/command hydration;
- runtime parity validation before first user or Loop prompt;
- OMP event forwarding to the webview;
- extension UI request/response routing;
- file/URL/log/diagnostic-terminal VS Code actions;
- status mapping for the session tree.

The webview owns presentation only. It never executes shell commands, reads arbitrary local
files, or decides tool authorization.

## Exact-parity contract

Project launch profiles may attach a parity contract. Dzialkopedia requires:

- active model `anthropic/claude-opus-5`;
- thinking level `max`;
- process spawn cwd equal to the selected worktree;
- exact active-tool inventory with no undeclared extras;
- `dzialki_policy_status` present in every profile, proving the repository policy
  extension loaded;
- work profile: full daily-development tools present and Loop-only custom tools absent;
- read-only profile: only safe read/navigation tools plus the policy marker;
- Loop profile: only canonical Loop tools, safe read tools, and the policy marker.

Repository preflight remains responsible for authenticated model catalog, advisor role and
tuning, task isolation, no-fallback policy, branch/worktree state, and canonical adapter bytes.
RPC runtime parity verifies the state that actually started after that preflight.

OMP `get_state` does not currently echo process cwd. Cwd parity therefore binds the exact
host-selected spawn directory and repository launcher path; model, thinking, and tool parity
come from OMP runtime state. This distinction is intentional and covered separately in launch
and runtime fixtures.

Any parity defect:

1. is rendered in the editor tab;
2. marks the session failed;
3. blocks initial `/loop-start` and all user prompts;
4. terminates the mismatched OMP process;
5. never opens the terminal automatically.

Standing parity fixtures include a known-good state and seeded wrong-model, wrong-effort,
wrong-cwd, missing-tool, forbidden-tool, and unexpected-tool states. Repository launchers are
accepted only from the canonical `TAKEOFF69/dzialki` Git origin; a lookalike folder cannot execute
its own `scripts/omp/launch.mjs`. Before Node executes any local launcher code, the
extension uses authenticated `gh api --hostname github.com` to load canonical GitHub
`main` tree hashes. A pinned full adapter inventory covers launcher, preflight, policy,
Loop runtime, and project context files; normalized local Git-blob hashes must match every
entry. The extension fetches the immutable canonical preflight blob by its tree SHA,
parses its duplicate-free `ADAPTER_PATHS`, and requires exact set equality with that
pinned inventory. Authentication, network, truncated tree, declaration, inventory,
containment, or hash mismatch fails closed.

## Capability mapping

| OMP capability | RPC surface |
| --- | --- |
| Streaming messages and thinking | Structured message cards |
| Tool calls and partial results | Live expandable tool cards |
| Skills and slash commands | Available-command menu + normal prompt path |
| Advisor advice | Native advisory cards emitted by OMP |
| Steering/follow-up/abort | Composer controls |
| Compaction/retry/TTSR | Timeline notices |
| Todos | Run rail and phase list |
| Subagents | Lifecycle/progress cards |
| Extension `select`/`confirm`/`input`/`editor` | Inline request cards |
| Extension status/widgets/notifications | Run rail and notices |
| Session history | Bounded `get_messages_page` traversal with documented busy/stale fallback |
| Model/thinking/context state | Run rail |
| Bash requiring real interaction | Explicit diagnostic terminal |

OMP custom TUI-only components are not fabricated. A project relying on unsupported custom UI
must fail its parity/acceptance review before cutover.

## Loop boundary

Loop v2 remains sole durable orchestration authority. RPC UI may render Loop tool calls and
canonical status, but it must not create a second scheduler, merge manager, lease system, or
checkpoint format. `/loop-start <alias>` remains the only operator entry point.

Conversation branching is safe. Generic filesystem rollback is intentionally excluded because
it can revert unrelated changes under parallel worktree activity.

## Acceptance

- RPC protocol unit tests cover split frames, malformed frames, chunk ordering, size bounds,
  mandatory v2 limits/negotiation, correlation, late same-ID failures, and awaited process exit.
- Parity selftest proves every seeded defect goes red and known-good state goes green.
- Project launcher selftests prove `--rpc` is owned, stdout remains protocol-clean, and Loop
  initial prompt is host-driven.
- Webview reducer tests cover streaming, tool progress, notices, advisor cards, and UI requests.
- Static webview browser pass covers desktop and narrow editor widths.
- RPC lifecycle fixture launches real child processes, renders canonical frames through reducers,
  round-trips confirmation, steers, aborts, and keeps two processes independently addressable.
- Pre-parity extension UI requests are cancelled without opening URLs, editors, or dialogs.
- Writer-lease fixtures prove repository root, nested folder, and junction paths collide on one
  lease, released only after the owned process tree exits.
- Extension deactivation awaits all session shutdowns. Diagnostic TUI is lease-free/read-only
  only under a trusted project launcher; generic TUI acquires a writer lease, and generic RPC
  read-only fails closed because ambient extension/MCP mutations cannot be excluded.
- Packaged VSIX contains extension host plus RPC JS/CSS bundles and installs as sole OMP extension.
- Installed-tab activation still requires manual visual confirmation when Windows UI automation
  is unavailable; static browser proof is not mislabeled as native VS Code interaction.
- Real OMP smoke requires completed provider authentication; if unavailable, cutover remains
  explicitly auth-blocked rather than being claimed from fixtures.
