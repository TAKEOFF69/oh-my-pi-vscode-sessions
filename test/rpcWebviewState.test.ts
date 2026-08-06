import assert from "node:assert/strict";
import test from "node:test";

import {
  applyHostFrame,
  countFoldedActivity,
  createInitialWebviewState,
  reduceRpcFrame,
  selectChatMessages,
} from "../src/rpc/webviewState";

test("webview reducer hydrates state and exact runtime surface", () => {
  let state = createInitialWebviewState();
  state = applyHostFrame(state, {
    type: "bootstrap",
    cwd: "C:\\work\\arc",
    branch: "wip/arc",
    sessionName: "Inspect RCN classifier",
    kind: "work",
    trustedProjectPolicy: true,
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
  assert.equal(state.runtime.trustedProjectPolicy, true);
  assert.deepEqual(state.runtime.tools, ["read", "edit"]);
});

test("webview reducer keeps generic runtime parity explicitly untrusted", () => {
  let state = createInitialWebviewState();
  state = applyHostFrame(state, {
    type: "bootstrap",
    kind: "work",
    parityRequired: true,
    trustedProjectPolicy: false,
  });
  state = applyHostFrame(state, { type: "parity", ok: true });

  assert.equal(state.runtime.parityRequired, true);
  assert.equal(state.runtime.trustedProjectPolicy, false);
  assert.equal(state.runtime.parity, "passed");
});

test("webview reducer never replaces a smart title with worktree infrastructure", () => {
  let state = createInitialWebviewState();
  state = applyHostFrame(state, {
    type: "bootstrap",
    cwd: "C:\\work\\omp-session-abc123",
    branch: "wip/20260804-omp-session-abc123",
    sessionName: "Test OMP session",
  });
  state = reduceRpcFrame(state, {
    type: "session_info_update",
    title: "wip/20260804-omp-session-abc123",
  });
  state = reduceRpcFrame(state, {
    type: "response",
    command: "get_state",
    success: true,
    data: { sessionName: "C:\\work\\omp-session-abc123" },
  });
  assert.equal(state.runtime.sessionName, "Test OMP session");

  state = reduceRpcFrame(state, {
    type: "session_info_update",
    title: "Research OMP runtime parity",
  });
  assert.equal(state.runtime.sessionName, "Research OMP runtime parity");
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
  const originalDetail = state.runtime.parityDetail;
  state = applyHostFrame(state, {
    type: "parity",
    ok: false,
    detail: "Runtime parity has not passed",
  });
  assert.equal(
    state.notices.filter((notice) => notice.title === "Runtime parity blocked")
      .length,
    1,
  );
  assert.equal(state.runtime.parityDetail, originalDetail);
});

test("provider overload becomes one retryable state instead of raw retry dump", () => {
  let state = createInitialWebviewState({
    transport: "ready",
    parity: "passed",
    isStreaming: true,
  });
  state = applyHostFrame(state, { type: "promptPending" });
  state = applyHostFrame(state, { type: "responseWaiting" });
  assert.equal(state.runtime.responseWaiting, true);

  state = reduceRpcFrame(state, {
    type: "message_end",
    message: {
      role: "assistant",
      isError: true,
      errorMessage: "Anthropic stream error (overloaded_error): Overloaded",
      content: [],
    },
  });
  state = reduceRpcFrame(state, {
    type: "auto_retry_start",
    attempt: 1,
    maxAttempts: 10,
    errorMessage: "Anthropic stream error (overloaded_error): Overloaded",
  });
  state = reduceRpcFrame(state, {
    type: "auto_retry_end",
    success: false,
    attempt: 1,
    finalError: "Retry cancelled",
  });

  assert.equal(state.runtime.providerIssue?.kind, "overloaded");
  assert.equal(state.runtime.responseWaiting, false);
  assert.equal(state.notices.some((notice) => /Retry 1\/10/.test(notice.title)), false);
  assert.equal(state.notices.some((notice) => /Retry (?:failed|cancelled)/i.test(notice.title)), false);
  assert.equal(selectChatMessages(state.messages).length, 0);
});

test("response timeout hides abort plumbing and clears on successful retry", () => {
  let state = createInitialWebviewState({
    transport: "ready",
    parity: "passed",
    isStreaming: true,
  });
  state = applyHostFrame(state, { type: "responseTimeout", timeoutMs: 20_000 });
  state = reduceRpcFrame(state, {
    type: "message_end",
    message: {
      role: "assistant",
      isError: true,
      errorMessage: "Request was aborted",
      content: [],
    },
  });
  assert.equal(state.runtime.providerIssue?.kind, "response-timeout");
  assert.equal(selectChatMessages(state.messages).length, 0);

  state = applyHostFrame(state, { type: "promptPending" });
  state = reduceRpcFrame(state, {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Recovered" }],
    },
  });
  assert.equal(state.runtime.providerIssue, undefined);
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

test("chat projection keeps one final answer and folds process transcript", () => {
  let state = createInitialWebviewState();
  const history = [
    { role: "user", content: [{ type: "text", text: "Who is the advisor?" }] },
    {
      role: "assistant",
      model: "claude-opus-5",
      content: [
        { type: "thinking", thinking: "Inspect config" },
        { type: "text", text: "I'll check." },
        { type: "toolCall", id: "one", name: "read", arguments: {} },
      ],
    },
    { role: "toolResult", content: [{ type: "text", text: "raw config" }] },
    {
      role: "custom",
      customType: "advisor",
      content: '<advisory severity="concern">Verify it.</advisory>',
    },
    {
      role: "assistant",
      model: "claude-opus-5",
      content: [{ type: "text", text: "Sol is the advisor." }],
    },
  ];
  state = reduceRpcFrame(state, {
    type: "response",
    command: "get_messages",
    success: true,
    data: { messages: history },
  });
  state = reduceRpcFrame(state, {
    type: "tool_execution_start",
    toolCallId: "one",
    toolName: "read",
    args: { path: ".omp/config.yml" },
  });
  state = reduceRpcFrame(state, {
    type: "tool_execution_end",
    toolCallId: "one",
    toolName: "read",
    result: { content: "raw config" },
  });

  const chat = selectChatMessages(state.messages);
  assert.deepEqual(
    chat.map((message) => message.content),
    [
      [{ type: "text", text: "Who is the advisor?" }],
      [{ type: "text", text: "Sol is the advisor." }],
    ],
  );
  assert.ok(countFoldedActivity(state.messages, chat, state.tools, []) >= 2);
});

test("chat projection hides synthetic runtime prompts and transient history busy", () => {
  let state = createInitialWebviewState();
  state = reduceRpcFrame(state, {
    type: "response",
    command: "get_messages",
    success: true,
    data: {
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: [{ type: "text", text: "Hi" }] },
        { role: "assistant", display: false, content: [{ type: "text", text: "hidden" }] },
        { role: "user", content: "### Session update [in progress]" },
        { role: "assistant", content: [{ type: "text", text: "meta" }] },
      ],
    },
  });
  state = reduceRpcFrame(state, {
    type: "response",
    command: "get_messages_page",
    success: false,
    code: "session_busy",
    error: "Cannot page messages while session is changing",
  });

  const chat = selectChatMessages(state.messages);
  assert.deepEqual(
    chat.map((message) => message.content),
    [
      [{ type: "text", text: "Hello" }],
      [{ type: "text", text: "Hi" }],
    ],
  );
  assert.equal(state.notices.length, 0);
});

test("chat projection suppresses hidden xdev inventory even when RPC omits display", () => {
  let state = createInitialWebviewState();
  state = reduceRpcFrame(state, {
    type: "response",
    command: "get_messages",
    success: true,
    data: {
      messages: [
        { role: "user", content: "TL;DR" },
        {
          role: "assistant",
          customType: "xdev-mount-notice",
          content:
            "<system-notice>\nThe xd:// device inventory changed.\n- xd://mcp__telegram_send_message\n</system-notice>",
        },
        { role: "assistant", content: "The work is ready." },
      ],
    },
  });

  assert.equal(state.messages[1]?.display, false);
  assert.deepEqual(
    selectChatMessages(state.messages).map((message) => message.content),
    [
      [{ type: "text", text: "TL;DR" }],
      [{ type: "text", text: "The work is ready." }],
    ],
  );
  assert.equal(
    countFoldedActivity(
      state.messages,
      selectChatMessages(state.messages),
      state.tools,
      state.subagents,
    ),
    0,
  );
});

test("user quoting xdev notice text remains visible", () => {
  let state = createInitialWebviewState();
  state = reduceRpcFrame(state, {
    type: "response",
    command: "get_messages",
    success: true,
    data: {
      messages: [
        {
          role: "user",
          content:
            "Why did I see <system-notice>The xd:// device inventory changed.</system-notice>?",
        },
        { role: "assistant", content: "That was hidden runtime metadata." },
      ],
    },
  });
  assert.equal(state.messages[0]?.display, undefined);
  assert.equal(selectChatMessages(state.messages).length, 2);
});

function waitingState() {
  let state = createInitialWebviewState();
  state = applyHostFrame(state, { type: "promptPending" });
  state = applyHostFrame(state, { type: "responseWaiting" });
  assert.equal(state.runtime.responseWaiting, true);
  return state;
}

test("a failed transport retires the response-start waiting state", () => {
  let state = waitingState();
  state = applyHostFrame(state, {
    type: "transport",
    status: "failed",
    detail: "OMP exited with code 1",
  });
  assert.equal(state.runtime.responseWaiting, false);
  assert.equal(state.runtime.transport, "failed");
  assert.equal(state.notices.at(-1)?.level, "error");
});

test("an exited transport retires the response-start waiting state", () => {
  let state = waitingState();
  state = applyHostFrame(state, { type: "transport", status: "exited" });
  assert.equal(state.runtime.responseWaiting, false);
});

test("a ready transport leaves the response-start waiting state alone", () => {
  let state = waitingState();
  state = applyHostFrame(state, { type: "transport", status: "ready" });
  assert.equal(state.runtime.responseWaiting, true);
});

test("blocked parity retires the response-start waiting state", () => {
  let state = waitingState();
  state = applyHostFrame(state, {
    type: "parity",
    ok: false,
    detail: "Advisor is not Sol/xhigh",
  });
  assert.equal(state.runtime.responseWaiting, false);
  assert.equal(state.runtime.parity, "failed");
});

test("responseIdle retires the waiting state without inventing an issue", () => {
  let state = waitingState();
  state = applyHostFrame(state, { type: "responseIdle" });
  assert.equal(state.runtime.responseWaiting, false);
  assert.equal(state.runtime.providerIssue, undefined);
});
