# Single-sidebar OMP contract

Status: implemented in 2.4.0; native extension-host reload smoke pending
Source: operator-supplied VS Code screenshots, 2026-08-04

## Decision

Normal OMP work lives in one VS Code sidebar webview. Home, recent chats, new-chat composer, and
conversation drill-in replace each other inside that view. Normal RPC sessions never create an
editor webview panel or choose another editor column. Independent OMP processes and writer
worktrees may continue concurrently behind that one selected conversation surface.

Every normal extension session is role-locked before prompts are accepted:

- driver: `anthropic/claude-opus-5`, thinking `xhigh`;
- advisor: `openai-codex/gpt-5.6-sol:xhigh`, enabled;
- post-start model/config responses and change events must preserve driver provider, model, and
  effort or terminate the runtime as a parity failure;
- task/smol roles: `openai-codex/gpt-5.6-luna:max`;
- retry model fallback: disabled.

## Visual parity matrix

| Reference element | Required OMP behavior | Verification |
| --- | --- | --- |
| One `Chats` sidebar | Home and conversation occupy same `WebviewView` | source guard rejects normal `createWebviewPanel` |
| Recent-chat rows and conversation header | Friendly context title, status, age; no visible worktree identity | browser fixture + title unit tests |
| Home composer at bottom | First prompt creates exactly one session | browser fixture + creation-gate tests |
| Row click | Drills into conversation in same sidebar | provider/router source and lifecycle tests |
| Conversation back action | Returns to same recent list without stopping runtime | router and active-selection tests |
| Conversation composer | Sends, steers, follows up, aborts through same RPC process | existing RPC reducer/bridge tests |
| Concurrent chats | Background processes remain alive; selecting row swaps only attached view | router isolation and replay-buffer tests |
| Model footer | `Opus 5 · Extra High`; advisor detail names GPT-5.6 Sol xhigh | launch/parity tests + browser proof |

## Data-provenance matrix

| Visible datum | Source | Class |
| --- | --- | --- |
| Chat title | first meaningful prompt, later durable OMP session name when emitted | runtime-derived |
| Chat status and age | extension session controller | runtime-real |
| Transcript and tool cards | OMP RPC frames/history | runtime-real |
| Driver model/effort | `get_state` after enforced `set_model`/`set_thinking_level` | runtime-real |
| Advisor label | extension-owned role overlay and `--advisor` launch contract | configured-real |
| Access label | parity result and selected tool policy | runtime-derived |

## Defects in 2.3.0

1. Sidebar row called `SessionPanel.reveal()`, which revealed a native editor webview panel.
2. Generic repositories passed no model, effort, advisor, or advisor-role overlay to OMP.
3. Exact parity existed only for canonical Dzialkopedia launcher sessions.
4. Generic repositories reused current checkout, preventing safe concurrent writer sessions.
5. Recent history contained only extension-recorded workspace-local metadata, not a complete OMP
   history index.
6. Smart titles were deterministic but often copied low-signal prompt wording too literally.
7. Completion was claimed before a live reloaded VS Code smoke; browser fixtures could not expose
   editor-column routing or generic-model fallback.

## Non-scope

- Diagnostic TUI remains an explicit advanced editor/terminal surface.
- Loop v2 authority, OMP wire protocol, session files, and project policy semantics do not change.
- Extension does not invent transcript content or title facts.
