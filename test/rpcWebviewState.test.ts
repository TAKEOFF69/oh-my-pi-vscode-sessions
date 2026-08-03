import assert from "node:assert/strict";
import test from "node:test";

import {
  applyHostFrame,
  createInitialWebviewState,
  reduceRpcFrame,
} from "../src/rpc/webviewState";

test("webview reducer hydrates state and exact runtime surface", () => {
  let state = createInitialWebviewState();
  state = applyHostFrame(state, {
    type: "bootstrap",
    cwd: "C:\\work\\arc",
    branch: "wip/arc",
    sessionName: "Inspect RCN classifier",
    kind: "work",
    advisorLabel: "Sol · xhigh",
  });
  state = reduceRpcFrame(state, {
    type: "response",
    command: "get_state",
    success: true,
    data: {
      model: { provider: "anthropic", id: "claude-opus-5" },
      thinkingLevel: "xhigh",
      queuedMessageCount: 2,
      contextUsage: { tokens: 1000, contextWindow: 200000, percent: 0.5 },
      dumpTools: [{ name: "read" }, { name: "edit" }],
      todoPhases: [],
    },
  });

  assert.equal(state.runtime.model?.id, "claude-opus-5");
  assert.equal(state.runtime.thinkingLevel, "xhigh");
  assert.equal(state.runtime.cwd, "C:\\work\\arc");
  assert.equal(state.runtime.sessionName, "Inspect RCN classifier");
  assert.equal(state.runtime.parityRequired, true);
  assert.deepEqual(state.runtime.tools, ["read", "edit"]);
});

test("webview reducer keeps generic runtime parity explicitly untrusted", () => {
  let state = createInitialWebviewState();
  state = applyHostFrame(state, {
    type: "bootstrap",
    kind: "work",
    parityRequired: false,
  });
  state = applyHostFrame(state, { type: "parity", ok: true });

  assert.equal(state.runtime.parityRequired, false);
  assert.equal(state.runtime.parity, "passed");
});

test("webview reducer streams messages and tool execution", () => {
  let state = createInitialWebviewState();
  state = reduceRpcFrame(state, {
    type: "message_start",
    message: {
      role: "assistant",
      model: "claude-opus-5",
      content: [{ type: "text", text: "Starting" }],
    },
  });
  state = reduceRpcFrame(state, {
    type: "message_update",
    message: {
      role: "assistant",
      model: "claude-opus-5",
      content: [
        { type: "thinking", thinking: "Check state" },
        { type: "text", text: "Starting now" },
      ],
    },
  });
  state = reduceRpcFrame(state, {
    type: "tool_execution_start",
    toolCallId: "tool-1",
    toolName: "read",
    args: { path: "README.md" },
  });
  state = reduceRpcFrame(state, {
    type: "tool_execution_end",
    toolCallId: "tool-1",
    toolName: "read",
    result: { content: "ok" },
  });
  state = reduceRpcFrame(state, {
    type: "message_end",
    message: {
      role: "assistant",
      model: "claude-opus-5",
      content: [{ type: "text", text: "Done" }],
    },
  });

  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0]?.streaming, false);
  assert.deepEqual(state.messages[0]?.content, [
    { type: "text", text: "Done" },
  ]);
  assert.equal(state.tools[0]?.status, "complete");
});

test("webview reducer renders advisor and extension UI requests", () => {
  let state = createInitialWebviewState();
  state = reduceRpcFrame(state, {
    type: "message_start",
    message: {
      role: "custom",
      customType: "advisor",
      content:
        '<advisory severity="blocker">Do not merge stale head.</advisory>',
    },
  });
  state = reduceRpcFrame(state, {
    type: "message_end",
    message: {
      role: "custom",
      customType: "advisor",
      content:
        '<advisory severity="blocker">Do not merge stale head.</advisory>',
    },
  });
  state = reduceRpcFrame(state, {
    type: "extension_ui_request",
    id: "ask-1",
    method: "confirm",
    title: "Run command?",
    message: "npm test",
  });

  assert.equal(state.messages[0]?.role, "advisory");
  assert.equal(state.requests[0]?.method, "confirm");
});

test("webview reducer follows canonical extension UI and subagent frames", () => {
  let state = createInitialWebviewState();
  state = reduceRpcFrame(state, {
    type: "extension_ui_request",
    id: "status-1",
    method: "setStatus",
    statusKey: "loop",
    statusText: "stage 2",
  });
  state = reduceRpcFrame(state, {
    type: "extension_ui_request",
    id: "widget-1",
    method: "setWidget",
    widgetKey: "evidence",
    widgetLines: ["3/3 checks", "digest bound"],
    widgetPlacement: "aboveEditor",
  });
  state = reduceRpcFrame(state, {
    type: "extension_ui_request",
    id: "input-1",
    method: "input",
    title: "Branch",
    placeholder: "wip/...",
  });
  state = reduceRpcFrame(state, {
    type: "extension_ui_request",
    id: "cancel-1",
    method: "cancel",
    targetId: "input-1",
  });
  state = reduceRpcFrame(state, {
    type: "subagent_progress",
    payload: {
      subagentId: "worker-1",
      name: "implementation-1",
      status: "running",
      currentTask: "Implementing share surface",
      currentTool: "edit",
    },
  });

  assert.equal(state.statuses.loop, "stage 2");
  assert.deepEqual(state.widgets.evidence, {
    lines: ["3/3 checks", "digest bound"],
    placement: "aboveEditor",
  });
  assert.equal(state.requests.length, 0);
  assert.equal(state.subagents[0]?.id, "worker-1");
  assert.equal(state.subagents[0]?.currentTool, "edit");
});

test("webview reducer exposes retries, compaction, and parity failure", () => {
  let state = createInitialWebviewState();
  state = reduceRpcFrame(state, {
    type: "auto_compaction_start",
    action: "context-full",
    reason: "threshold",
  });
  state = reduceRpcFrame(state, {
    type: "auto_retry_start",
    attempt: 1,
    maxAttempts: 3,
    errorMessage: "rate limited",
  });
  state = applyHostFrame(state, {
    type: "parity",
    ok: false,
    detail: "model-id mismatch",
  });

  assert.equal(state.runtime.isCompacting, true);
  assert.equal(state.runtime.parity, "failed");
  assert.ok(state.notices.some((notice) => notice.title === "Runtime parity blocked"));
});

test("nonterminal agent_end keeps continuation streaming", () => {
  let state = createInitialWebviewState({ isStreaming: true });
  state = reduceRpcFrame(state, {
    type: "agent_end",
    isTerminal: false,
  });
  assert.equal(state.runtime.isStreaming, true);

  state = reduceRpcFrame(state, {
    type: "agent_end",
    isTerminal: true,
  });
  assert.equal(state.runtime.isStreaming, false);
});

test("failed response is always visible", () => {
  const state = reduceRpcFrame(createInitialWebviewState(), {
    type: "response",
    id: "prompt-1",
    command: "prompt",
    success: false,
    error: "queue rejected",
    code: "queue_rejected",
  });
  assert.ok(
    state.notices.some(
      (notice) =>
        notice.level === "error" &&
        notice.detail?.includes("queue rejected"),
    ),
  );
});
