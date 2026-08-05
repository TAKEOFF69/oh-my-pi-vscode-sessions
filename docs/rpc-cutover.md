# RPC-native sidebar cutover

## Outcome

Make OMP RPC mode the default session surface while keeping OMP itself as the only agent
runtime. The extension renders structured OMP events; it does not reimplement planning,
tools, skills, advisor behavior, model routing, session storage, or Loop authority.

Each live chat still owns:

- one OMP process;
- one OMP session;
- one selected folder or Git worktree;
- one cross-process writer lease when the session may mutate files.

The legacy xterm surface remains available only through an explicitly named diagnostic
command. It is never an automatic fallback and never runs beside an RPC session.

## UX direction

The one sidebar follows Codex's quiet native-chat hierarchy while retaining OMP evidence:

- compact `Chats` header for session directory, settings, and duplicate-gated New Session;
- flat readable conversation canvas with restrained user/assistant separation;
- one final assistant answer per user turn and one collapsed activity disclosure;
- bottom-docked rounded composer with real access, model, effort, send, steer, follow-up, and abort;
- worktree/branch identity below composer rather than a persistent technical rail;
- errors and extension requests inline; routine notices, retries, compaction, TTSR, thinking,
  advisor, tools, and subagent progress folded behind activity;
- direct file and URL handoff to VS Code;
- visible transport and parity failures with no terminal fallback.

Runtime status stays available through compact header indicator, composer state, and tooltips. Flat
canvas and muted VS Code theme variables dominate; yellow marks access/execution, red marks real
failures. Independent background hosts and writer leases remain multi-session boundary; normal
chat navigation creates no editor panel.

## Runtime architecture

```text
SessionManager
  -> Sidebar WebviewView (one selected presentation)
  -> selected-session router
     -> RpcSessionHost[] (independent background hosts)
        -> RpcProcess[] (stdio JSONL, protocol v2)
           -> exact OMP runtimes + isolated worktrees
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
- detached-session frame buffering and selected-view rehydration;
- extension UI request/response routing;
- file/URL/log/diagnostic-terminal VS Code actions;
- status mapping for the session tree.

The webview owns presentation only. It never executes shell commands, reads arbitrary local
files, or decides tool authorization.

## Exact-parity contract

Project launch profiles may attach a parity contract. Dzialkopedia requires:

- active model `anthropic/claude-opus-5`;
- thinking level `xhigh`;
- process spawn cwd equal to the selected worktree;
- exact active-tool inventory with no undeclared extras;
- `dzialki_policy_status` present in every profile, proving the repository policy
  extension loaded;
- work profile: full daily-development tools plus narrow `loop_handoff`; direct
  Loop lifecycle and dispatch tools absent;
- read-only profile: only safe read/navigation tools plus the policy marker;
- Loop profile: only canonical Loop tools, safe read tools, and the policy marker.

Repository preflight remains responsible for authenticated model catalog, advisor role and
tuning, task isolation, no-fallback policy, branch/worktree state, and canonical adapter bytes.
RPC runtime parity verifies the state that actually started after that preflight.
Because OMP `get_state` omits advisor state, trusted sessions issue hidden local `/advisor status`
probes before first prompt and after terminal turns. Exact running
`openai-codex/gpt-5.6-sol` identity is required; command output never enters conversation.
Probes are single-flight and bound to current RPC generation. Restart invalidates old result,
user prompts wait for an in-flight check, and ambient MCP detection runs before hidden output
suppression.

OMP `get_state` does not currently echo process cwd. Cwd parity therefore binds the exact
host-selected spawn directory and repository launcher path; model, thinking, and tool parity
come from OMP runtime state. This distinction is intentional and covered separately in launch
and runtime fixtures.

Any parity defect:

1. is rendered in selected sidebar conversation;
2. marks the session failed;
3. blocks initial `/loop-start` and all user prompts;
4. terminates the mismatched OMP process;
5. never opens the terminal automatically.

Standing parity fixtures include a known-good state and seeded wrong-model, wrong-effort,
wrong-cwd, missing-tool, forbidden-tool, and unexpected-tool states. Repository launchers are
accepted only from the current or approved post-rename alias for the same canonical Dzialkopedia
repository (`TAKEOFF69/dzialki` or `mateusz-stawczyk/dzialki`); a lookalike folder cannot execute
its own `scripts/omp/launch.mjs`. Before Node executes any local launcher code, the
extension uses authenticated `gh api --hostname github.com` to load canonical GitHub
`main` tree hashes. A pinned full adapter inventory covers launcher, preflight, policy,
Loop runtime, and project context files; normalized local Git-blob hashes must match every
entry. The extension fetches the immutable canonical preflight blob by its tree SHA,
parses its duplicate-free `ADAPTER_PATHS`, and requires exact set equality with that
pinned inventory. Authentication, network, truncated tree, declaration, inventory,
containment, or hash mismatch fails closed. Repository metadata must also match stable GitHub node
ID `R_kgDORpREFA`, so a future holder of either username cannot satisfy canonical trust.

## Capability mapping

| OMP capability | RPC surface |
| --- | --- |
| Streaming messages and thinking | Text-first final answer; thinking folded behind activity |
| Tool calls and partial results | One collapsed activity row with expandable tool details |
| Skills and slash commands | Available-command menu + normal prompt path |
| Advisor advice | Folded activity; final answer remains primary conversation |
| Steering/follow-up/abort | Composer controls |
| Prompt images | Clipboard previews forwarded as bounded OMP `ImageContent[]` |
| Compaction/retry/TTSR | Folded activity; failures visible |
| Todos | Folded activity |
| Subagents | Folded lifecycle/progress summary |
| Extension `select`/`confirm`/`input`/`editor` | Inline request cards |
| Extension status/widgets/notifications | Timeline status and notices |
| Session history | Bounded `get_messages_page` traversal with documented busy/stale fallback |
| Model/thinking/context state | Composer and compact header status |
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
- Webview reducer tests cover streaming, tool progress, notices, folded advisor activity, and UI requests.
- Static webview browser pass covers desktop and narrow sidebar widths.
- Browser pass pastes a real PNG into home and active composers, verifies preview/remove state,
  and asserts exact first-prompt and RPC image payloads.
- RPC lifecycle fixture launches real child processes, renders canonical frames through reducers,
  round-trips confirmation, steers, aborts, and keeps two processes independently addressable.
- Pre-parity extension UI requests are cancelled without opening URLs, editors, or dialogs.
- Writer-lease fixtures prove repository root, nested folder, and junction paths collide on one
  lease, released only after the owned process tree exits.
- Extension deactivation awaits all session shutdowns. Diagnostic TUI is lease-free/read-only
  only under a trusted project launcher; generic TUI acquires a writer lease, and generic RPC
  read-only fails closed because ambient extension/MCP mutations cannot be excluded.
- Packaged VSIX contains extension host plus RPC JS/CSS bundles and installs as sole OMP extension.
- Installed-sidebar activation still requires manual visual confirmation when Windows UI automation
  is unavailable; static browser proof is not mislabeled as native VS Code interaction.
- OMP 17.2.9 is minimum trusted runtime. Automated RPC fixture proves exact Opus 5/xhigh parity and
  hidden live Sol advisor probe; provider-backed installed-sidebar smoke remains release evidence.
