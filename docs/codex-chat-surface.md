# Codex-like chat surface

Status: approved by operator screenshot request
Reference: Codex VS Code chat screenshot supplied in conversation on 2026-08-02
Scope: structured RPC editor webview only

## Intent

Make an OMP session feel visually native beside Codex: quiet chrome, broad empty canvas, compact
conversation rows, and a bottom-docked composer. Preserve OMP RPC behavior, native editor tabs,
parallel worktrees, parity checks, advisor events, tool evidence, and session teardown semantics.

## Bounded parity matrix

| Reference element | Literal target | OMP implementation | Strategy |
| --- | --- | --- | --- |
| Pane background | Flat VS Code dark surface, no decorative grid | Remove grid and card backdrop from `.app` | shared-identical |
| Top chrome | Small `Chats` label with quiet icon actions and one divider | Compact session header with Sessions, New Session, Search, Logs, Settings | shared-with-functional-overrides |
| Empty canvas | Large negative space with one muted centered mark | Muted OMP orbit/pi mark; no marketing card or shortcut copy | shared-identical |
| Conversation | Text-first, narrow readable column, little permanent chrome | Remove avatar column and persistent role labels; retain subtle user/advisor distinctions | shared-with-functional-overrides |
| Tool activity | Compact action rows; detail only on demand | One-line tool header with expandable result | shared-identical |
| Composer | Rounded bordered field docked near bottom | Rounded composer with message field and bottom control row | shared-identical |
| Composer left controls | Plus action and access state | Plus menu for logs/diagnostic terminal/find; exact Dzialki policy label or honest generic `Custom access` | shared-with-functional-overrides |
| Composer right controls | Model label and circular send/stop button | Live OMP model/effort label and circular send/stop control | shared-identical |
| Local context footer | `Work locally` row | Branch/worktree row below composer | shared-with-real-data |
| Recent chat overlay | Searchable saved chat list | Native OMP Sessions sidebar remains session directory | production deviation |

## Data provenance

| Visible datum | Source | Class |
| --- | --- | --- |
| Session name | OMP `session_info_update` / launch label | runtime-real |
| Model and effort | OMP `get_state` and config events | runtime-real |
| Access mode | Session kind plus exact-parity state; generic unverified profiles say `Custom access` | runtime-real |
| Branch and directory | Extension launch specification | runtime-real |
| Context and queue state | OMP `get_state` | runtime-real |
| Messages, tools, advisor, notices, subagents | OMP RPC frames | runtime-real |

No sample screenshot title, age, model, permission, or session entry ships as hard-coded runtime
fact. Test harness values remain fixtures only.

## Deviations

- Native editor tabs remain because operator requires several concurrent sessions in one VS Code
  window. Codex screenshot uses one sidebar conversation.
- Saved/recent chat search stays in OMP's native Sessions view rather than duplicating session
  authority inside every editor tab.
- OMP advisor, parity, compaction, task, and tool evidence remains renderable. It is visually
  demoted, not removed or fabricated.

## Acceptance evidence

- Existing RPC behavior and parity suites remain green.
- Desktop, `430x800`, and screenshot-like `457x1000` renders have no horizontal overflow or console
  errors.
- Empty state and populated conversation both render.
- Composer remains keyboard-operable; action menu, search, tool expansion, send, steer/follow-up,
  abort, requests, and editor-context insertion remain functional.
- Startup drafts cannot submit before transport/parity readiness, and request-card input survives
  unrelated RPC frames.
- Streaming updates patch changed message nodes instead of rebuilding full history; expanded tool
  evidence remains open across later frames.
- Screenshot inspection confirms flat canvas, compact header, readable content, bottom composer,
  and local context row match reference hierarchy.

## Non-scope

- Changing OMP runtime, model routing, advisor behavior, Loop v2, worktree creation, or leases.
- Replacing native editor tabs with one sidebar process.
- Inventing filesystem checkpoints or replaying old worktrees as writable sessions.
