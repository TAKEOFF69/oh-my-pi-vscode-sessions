# Quiet chat activity contract

Status: implementation target
Reference: operator screenshots of OMP Sessions and Codex chat, 2026-08-05

## Decision

The selected OMP conversation is a chat transcript, not a protocol console. Show user messages and
the final assistant answer for each turn. Keep reasoning, advisor exchanges, tool calls, tool
results, subagent progress, and routine runtime metadata in one collapsed activity disclosure.
Errors, parity failures, and extension requests that require operator action remain prominent.

## Bounded parity matrix

| Reference element | Required behavior | Strategy |
| --- | --- | --- |
| Codex transcript | One user message followed by one readable final answer | Keep last substantive assistant text in each user turn |
| Work in progress | Quiet running state without repeated assistant/model cards | Composer stop state plus one collapsed activity summary |
| Tool evidence | Available on demand, absent from normal reading flow | One closed `Activity · N steps` disclosure |
| Reasoning | Not exposed as ordinary chat | Fold into activity; never open by default |
| Advisor | Influences answer without becoming a second conversation | Fold advisory messages into activity |
| Model identity | One truthful footer label | OMP runtime state in composer footer only |
| Failures | Actionable without reopening the process dump | Keep failed count visible; details remain user-expandable |
| Extension requests | Operator can answer genuine workflow input | Keep ordinary prompt/confirm/select overlay; trusted no-popup tool approvals fail closed |

## Data provenance

| Visible datum | Source | Class |
| --- | --- | --- |
| User and final assistant text | OMP RPC message history/events | runtime-real |
| Activity count/status/details | OMP tool, thinking, advisory, and subagent events | runtime-derived |
| Error and parity banners | OMP/extension runtime frames | runtime-real |
| Model and effort footer | OMP `get_state` and config events | runtime-real |

No transcript content, work result, model label, or success state is invented. Folding changes only
presentation; raw OMP session history remains authoritative and available to the runtime.

## Acceptance evidence

- A turn containing interim narration, reasoning, advisor messages, and tool calls renders one user
  message, one final assistant answer, and one closed activity disclosure.
- Successful tool results and hidden `xdev-mount-notice` inventory dumps are absent from transcript.
- Failed-tool count, parity failure, transport failure, retry exhaustion, and genuine pending
  extension requests remain visible without automatically opening Activity.
- History hydration and live streaming produce the same presentation.
- Long histories keep bounded incremental rendering and no horizontal overflow at sidebar width.
- Browser screenshot inspection confirms no repeated Assistant/model labels or open process ledger.

## Non-scope

- Removing evidence from OMP session files.
- Changing model, advisor, worktree, Loop, or permission policy.
- Hiding errors or operator decisions.
