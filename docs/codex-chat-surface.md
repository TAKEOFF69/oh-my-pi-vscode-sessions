# Codex-like chat surface

Status: approved by operator screenshot request
Reference: Codex VS Code chat screenshots supplied in conversation on 2026-08-02 and 2026-08-03
Scope: OMP Sessions sidebar plus structured RPC editor webview

## Intent

Make OMP feel visually native beside Codex from first open: recent/live chat titles at top, broad
empty canvas, and a bottom-docked composer that creates one session from its first prompt. Preserve
OMP RPC behavior, native editor tabs, parallel worktrees, parity checks, advisor events, tool
evidence, and session teardown semantics. Opening or focusing the sidebar never provisions a
worktree or starts OMP.

## Bounded parity matrix

| Reference element | Literal target | OMP implementation | Strategy |
| --- | --- | --- | --- |
| Default sidebar | `Chats` list above a quiet canvas and composer pinned to bottom | Replace native TreeView/welcome button with one WebviewView using same hierarchy | shared-identical |
| New-chat lifecycle | Empty composer exists before any runtime; first send creates chat | Focus/clear composer without spawning; one guarded submit provisions one worktree/session and carries exact prompt into RPC after parity | shared-with-runtime-guard |
| Chat list | Compact contextual titles; infrastructure identifiers absent from visible name | Merge live sessions with bounded extension-owned recent descriptors; keep branch/worktree in tooltip/internal lease state | shared-with-real-data |
| Title lifecycle | Human task name appears immediately and improves from conversation context | Derive safe provisional title from first prompt; accept later OMP title events; reject branch/path-shaped titles | shared-with-runtime-guard |
| Pane background | Flat VS Code dark surface, no decorative grid | Remove grid and card backdrop from `.app` | shared-identical |
| Top chrome | Small `Chats` label with quiet icon actions and one divider | Compact session header with Sessions, New Session, Search, Logs, Settings | shared-with-functional-overrides |
| Empty canvas | Large negative space with one muted centered mark | Muted OMP orbit/pi mark; no marketing card or shortcut copy | shared-identical |
| Conversation | Text-first, narrow readable column, little permanent chrome | Remove avatar column and persistent role labels; retain subtle user/advisor distinctions | shared-with-functional-overrides |
| Tool activity | Compact action rows; detail only on demand | One-line tool header with expandable result | shared-identical |
| Composer | Rounded bordered field docked near bottom | Rounded composer with message field and bottom control row | shared-identical |
| Composer left controls | Plus action and access state | Plus menu for logs/diagnostic terminal/find; exact Dzialki policy label or honest generic `Custom access` | shared-with-functional-overrides |
| Composer right controls | Model label and circular send/stop button | Live OMP model/effort label and circular send/stop control | shared-identical |
| Local context footer | `Work locally` row | Branch/worktree row below composer | shared-with-real-data |
| Recent chat overlay | Searchable saved chat list | Sidebar shows live chats plus at most 50 extension-created recent descriptors; transcript remains in OMP | shared-with-runtime-guard |

## Data provenance

| Visible datum | Source | Class |
| --- | --- | --- |
| Session name | First prompt provisional title, then OMP `session_info_update` / `setTitle` | runtime-real |
| Model and effort | OMP `get_state` and config events | runtime-real |
| Access mode | Session kind plus exact-parity state; generic unverified profiles say `Custom access` | runtime-real |
| Branch and directory | Extension launch specification | runtime-real |
| Context and queue state | OMP `get_state` | runtime-real |
| Messages, tools, advisor, notices, subagents | OMP RPC frames | runtime-real |

No sample screenshot title, age, model, permission, or session entry ships as hard-coded runtime
fact. Test harness values remain fixtures only.

## Deviations

- Native editor tabs remain because operator requires several concurrent sessions in one VS Code
  window. Sidebar is launcher/directory; each live chat still owns one editor tab and one worktree.
- Recent index stores only title, exact cwd/branch, OMP session-file pointer, kind, and timestamp.
  It never copies transcripts or scans OMP storage. A dormant row resumes only exact surviving
  worktree/session bytes after writer-lease and launcher validation; missing/stale state reports
  unavailable and never creates a replacement worktree silently.
- OMP advisor, parity, compaction, task, and tool evidence remains renderable. It is visually
  demoted, not removed or fabricated.

## Acceptance evidence

- Existing RPC behavior and parity suites remain green.
- Desktop, `430x800`, and screenshot-like `457x1000` renders have no horizontal overflow or console
  errors.
- Empty state and populated conversation both render.
- Sidebar renders at `340x980` and `430x800` with chat list above bottom composer, no native welcome
  button, no horizontal overflow, and no visible branch/worktree as session title.
- Opening/focusing sidebar creates zero worktrees and zero OMP processes. One first-prompt submit
  creates exactly one session; double submit joins/ignores same in-flight creation; failure restores
  exact draft.
- Provisional title is prompt-derived and branch/path-shaped runtime titles never replace it.
- Closing/reloading retains at most 50 extension-created recent descriptors without starting OMP;
  clicking a live row focuses it and clicking a dormant row resumes exact stored session/worktree.
- Composer remains keyboard-operable; action menu, search, tool expansion, send, steer/follow-up,
  abort, requests, and editor-context insertion remain functional.
- Startup drafts cannot submit before transport/parity readiness, and request-card input survives
  unrelated RPC frames.
- Streaming updates patch changed message nodes instead of rebuilding full history; expanded tool
  evidence remains open across later frames.
- Screenshot inspection confirms flat canvas, compact header, readable content, bottom composer,
  and local context row match reference hierarchy.

## Non-scope

- Changing Loop v2, worktree isolation, or leases. Model routing changes remain repository-owned and
  parity-gated outside this visual contract.
- Replacing native editor tabs with one sidebar process.
- Inventing filesystem checkpoints or replaying old worktrees as writable sessions.
