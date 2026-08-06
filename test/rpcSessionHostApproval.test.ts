import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import Module from "node:module";
import test from "node:test";

type ModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown;
const moduleWithLoader = Module as unknown as { _load: ModuleLoader };
const originalLoad = moduleWithLoader._load;
moduleWithLoader._load = function load(
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "vscode") {
    return {
      window: {
        showErrorMessage: async () => undefined,
        showInformationMessage: async () => undefined,
      },
      commands: { executeCommand: async () => undefined },
      Uri: { parse: (value: string) => ({ scheme: value.split(":", 1)[0] }) },
      workspace: {},
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const fixturePath = fileURLToPath(
  new URL("./fixtures/fake-omp-rpc.mjs", import.meta.url),
);
const fixtureTools = [
  "read",
  "grep",
  "glob",
  "lsp",
  "todo",
  "bash",
  "edit",
  "write",
  "task",
];

test("verified Dzialki host cancels unexpected approval, restores draft, and reaps RPC", async () => {
  const [{ RpcSessionHost }, { RpcProcess }] = await Promise.all([
    import("../src/rpc/RpcSessionHost"),
    import("../src/rpc/RpcProcess"),
  ]);
  moduleWithLoader._load = originalLoad;
  const sent: Record<string, unknown>[] = [];
  let disposeCalls = 0;
  const originalSend = RpcProcess.prototype.send;
  const originalDispose = RpcProcess.prototype.dispose;
  RpcProcess.prototype.send = function send(frame: Record<string, unknown>) {
    sent.push(frame);
    return originalSend.call(this, frame);
  };
  RpcProcess.prototype.dispose = function dispose() {
    disposeCalls += 1;
    return originalDispose.call(this);
  };

  const statuses: string[] = [];
  const posts: Record<string, unknown>[] = [];
  const host = new RpcSessionHost({
    cwd: process.cwd(),
    kind: "work",
    executable: process.execPath,
    args: [fixturePath, "--approval-request"],
    label: "Approval tripwire",
    parity: {
      name: "dzialki-work",
      provider: "anthropic",
      modelId: "claude-opus-5",
      thinkingLevel: "xhigh",
      cwd: process.cwd(),
      requiredTools: fixtureTools,
      allowedTools: fixtureTools,
      forbiddenTools: [],
    },
    logger: {
      info() {},
      error() {},
      show() {},
      dispose() {},
    },
    onStatusChange: (status) => statuses.push(status),
    onTitleChange: () => false,
    onSessionFileChange() {},
    onLoopHandoff() {},
  });
  host.attachWebview(
    {
      postMessage: async (message: Record<string, unknown>) => {
        posts.push(message);
        return true;
      },
    } as never,
    "approval-surface",
  );

  try {
    await host.handleWebviewMessage({ type: "ready" });
    await host.handleWebviewMessage({
      type: "prompt",
      message: "run approval probe",
      images: [],
    });
    await waitFor(() => disposeCalls > 0 && statuses.includes("failed"));

    assert.ok(
      sent.some(
        (frame) =>
          frame.type === "extension_ui_response" &&
          frame.id === "approval-1" &&
          frame.cancelled === true,
      ),
    );
    assert.ok(
      posts.some(
        (frame) =>
          frame.type === "parity" &&
          frame.ok === false &&
          String(frame.detail).includes("no-popup access drifted"),
      ),
    );
    assert.ok(
      posts.some(
        (frame) =>
          frame.type === "restoreDraft" &&
          frame.text === "run approval probe",
      ),
    );
    assert.equal(
      posts.some(
        (frame) =>
          frame.type === "rpc" &&
          (frame.frame as Record<string, unknown> | undefined)?.id ===
            "approval-1",
      ),
      false,
    );
  } finally {
    await host.dispose();
    RpcProcess.prototype.send = originalSend;
    RpcProcess.prototype.dispose = originalDispose;
  }

  const genericStatuses: string[] = [];
  const genericPosts: Record<string, unknown>[] = [];
  let firstPromptAccepts = 0;
  let firstPromptStarts = 0;
  const genericHost = new RpcSessionHost({
    cwd: process.cwd(),
    kind: "work",
    executable: process.execPath,
    args: [fixturePath, "--approval-request"],
    label: "Generic approval",
    parity: {
      name: "generic-work",
      provider: "anthropic",
      modelId: "claude-opus-5",
      thinkingLevel: "xhigh",
      cwd: process.cwd(),
      requiredTools: fixtureTools,
      allowedTools: fixtureTools,
      forbiddenTools: [],
    },
    logger: {
      info() {},
      error() {},
      show() {},
      dispose() {},
    },
    onStatusChange: (status) => genericStatuses.push(status),
    onTitleChange: () => false,
    onSessionFileChange() {},
    onLoopHandoff() {},
    onFirstPromptAccepted() {
      firstPromptAccepts += 1;
    },
    onFirstPromptStarted() {
      firstPromptStarts += 1;
    },
  });
  genericHost.attachWebview(
    {
      postMessage: async (message: Record<string, unknown>) => {
        genericPosts.push(message);
        return true;
      },
    } as never,
    "generic-surface",
  );
  try {
    await genericHost.handleWebviewMessage({ type: "ready" });
    assert.equal(firstPromptAccepts, 0, "session file alone must not claim worktree");
    assert.equal(firstPromptStarts, 0);
    await genericHost.handleWebviewMessage({
      type: "prompt",
      message: "run generic approval probe",
      images: [],
    });
    assert.equal(firstPromptAccepts, 1);
    assert.equal(firstPromptStarts, 1);
    assert.equal(genericStatuses.includes("failed"), false);
    assert.ok(
      genericPosts.some(
        (frame) =>
          frame.type === "rpc" &&
          (frame.frame as Record<string, unknown> | undefined)?.id ===
            "approval-1",
      ),
    );
  } finally {
    await genericHost.dispose();
  }
});

test("user prompt waits for the single live advisor probe", async () => {
  const { RpcSessionHost } = await import("../src/rpc/RpcSessionHost");
  let accepted = 0;
  const posts: Record<string, unknown>[] = [];
  const host = new RpcSessionHost({
    cwd: process.cwd(),
    kind: "work",
    executable: process.execPath,
    args: [fixturePath, "--slow-advisor"],
    label: "Advisor serialization",
    parity: {
      name: "dzialki-work",
      provider: "anthropic",
      modelId: "claude-opus-5",
      thinkingLevel: "xhigh",
      cwd: process.cwd(),
      requiredTools: fixtureTools,
      allowedTools: fixtureTools,
      forbiddenTools: [],
    },
    logger: { info() {}, error() {}, show() {}, dispose() {} },
    onStatusChange() {},
    onTitleChange: () => false,
    onSessionFileChange() {},
    onLoopHandoff() {},
    onFirstPromptAccepted() { accepted += 1; },
  });
  host.attachWebview({
    postMessage: async (message: Record<string, unknown>) => {
      posts.push(message);
      return true;
    },
  } as never, "advisor-surface");
  try {
    await host.handleWebviewMessage({ type: "ready" });
    await host.handleWebviewMessage({
      type: "prompt",
      message: "first",
      images: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 170));
    await host.handleWebviewMessage({
      type: "prompt",
      message: "second",
      images: [],
    });
    assert.equal(accepted, 1, "worktree claim callback remains exactly once");
    assert.equal(
      posts.some((frame) =>
        frame.type === "restoreDraft" && frame.text === "second"),
      false,
    );
  } finally {
    await host.dispose();
  }
});

test("Dzialki response-start deadline aborts hidden provider wait and preserves retry state", async () => {
  const { RpcSessionHost } = await import("../src/rpc/RpcSessionHost");
  const posts: Record<string, unknown>[] = [];
  const statuses: string[] = [];
  const host = new RpcSessionHost({
    cwd: process.cwd(),
    kind: "work",
    executable: process.execPath,
    args: [fixturePath, "--hang-turn"],
    label: "Response deadline",
    parity: {
      name: "dzialki-work",
      provider: "anthropic",
      modelId: "claude-opus-5",
      thinkingLevel: "xhigh",
      cwd: process.cwd(),
      requiredTools: fixtureTools,
      allowedTools: fixtureTools,
      forbiddenTools: [],
    },
    responseStartWaitMs: 20,
    responseStartTimeoutMs: 40,
    logger: { info() {}, error() {}, show() {}, dispose() {} },
    onStatusChange: (status) => statuses.push(status),
    onTitleChange: () => false,
    onSessionFileChange() {},
    onLoopHandoff() {},
  });
  host.attachWebview({
    postMessage: async (message: Record<string, unknown>) => {
      posts.push(message);
      return true;
    },
  } as never, "response-deadline");
  try {
    await host.handleWebviewMessage({ type: "ready" });
    await host.handleWebviewMessage({
      type: "prompt",
      message: "provider wait",
      images: [],
    });
    await waitFor(() =>
      posts.some((frame) => frame.type === "responseTimeout") &&
      posts.some(
        (frame) =>
          frame.type === "rpc" &&
          (frame.frame as Record<string, unknown> | undefined)?.type ===
            "agent_end",
      ),
    );
    assert.ok(posts.some((frame) => frame.type === "responseWaiting"));
    assert.ok(
      posts.some(
        (frame) => frame.type === "responseTimeout" && frame.timeoutMs === 40,
      ),
    );
    assert.ok(
      posts.some(
        (frame) =>
          frame.type === "rpc" &&
          (frame.frame as Record<string, unknown> | undefined)?.type ===
            "agent_end",
      ),
    );
  } finally {
    await host.dispose();
  }
});

test("Dzialki exact-model host cancels OMP outer overload retry", async () => {
  const { RpcSessionHost } = await import("../src/rpc/RpcSessionHost");
  const posts: Record<string, unknown>[] = [];
  const statuses: string[] = [];
  const host = new RpcSessionHost({
    cwd: process.cwd(),
    kind: "work",
    executable: process.execPath,
    args: [fixturePath, "--overload-retry"],
    label: "Overload retry",
    parity: {
      name: "dzialki-work",
      provider: "anthropic",
      modelId: "claude-opus-5",
      thinkingLevel: "xhigh",
      cwd: process.cwd(),
      requiredTools: fixtureTools,
      allowedTools: fixtureTools,
      forbiddenTools: [],
    },
    logger: { info() {}, error() {}, show() {}, dispose() {} },
    onStatusChange: (status) => statuses.push(status),
    onTitleChange: () => false,
    onSessionFileChange() {},
    onLoopHandoff() {},
  });
  host.attachWebview({
    postMessage: async (message: Record<string, unknown>) => {
      posts.push(message);
      return true;
    },
  } as never, "overload-retry");
  try {
    await host.handleWebviewMessage({ type: "ready" });
    await host.handleWebviewMessage({
      type: "prompt",
      message: "overloaded provider",
      images: [],
    });
    await waitFor(() =>
      posts.some(
        (frame) =>
          frame.type === "rpc" &&
          (frame.frame as Record<string, unknown> | undefined)?.type ===
            "agent_end",
      ),
    );
    assert.ok(
      posts.some(
        (frame) =>
          frame.type === "rpc" &&
          (frame.frame as Record<string, unknown> | undefined)?.type ===
            "auto_retry_start",
      ),
    );
    assert.ok(
      posts.some(
        (frame) =>
          frame.type === "rpc" &&
          (frame.frame as Record<string, unknown> | undefined)?.type ===
            "auto_retry_end" &&
          (frame.frame as Record<string, unknown>).finalError ===
            "Retry cancelled",
      ),
    );
  } finally {
    await host.dispose();
  }
});

test("dispose and restart release an in-flight first-prompt reservation exactly once", async () => {
  const { RpcSessionHost } = await import("../src/rpc/RpcSessionHost");
  for (const action of ["dispose", "restart"] as const) {
    let accepted = 0;
    let started = 0;
    let rejected = 0;
    const host = new RpcSessionHost({
      cwd: process.cwd(),
      kind: "work",
      executable: process.execPath,
      args: [fixturePath, "--hang-prompt"],
      label: `First prompt ${action}`,
      parity: {
        name: "dzialki-work",
        provider: "anthropic",
        modelId: "claude-opus-5",
        thinkingLevel: "xhigh",
        cwd: process.cwd(),
        requiredTools: fixtureTools,
        allowedTools: fixtureTools,
        forbiddenTools: [],
      },
      logger: { info() {}, error() {}, show() {}, dispose() {} },
      onStatusChange() {},
      onTitleChange: () => false,
      onSessionFileChange() {},
      onLoopHandoff() {},
      onFirstPromptStarted() { started += 1; },
      onFirstPromptAccepted() { accepted += 1; },
      onFirstPromptRejected() { rejected += 1; },
    });
    host.attachWebview({ postMessage: async () => true } as never, `first-${action}`);
    await host.handleWebviewMessage({ type: "ready" });
    const pendingPrompt = host.handleWebviewMessage({
      type: "prompt",
      message: "hold this prompt",
      images: [],
    });
    await waitFor(() => started === 1);
    if (action === "restart") await host.restart();
    else await host.dispose();
    await pendingPrompt;
    assert.equal(accepted, 0, `${action} must not claim an unacknowledged prompt`);
    assert.equal(rejected, 1, `${action} must release reservation exactly once`);
    await host.dispose();
    assert.equal(rejected, 1, `${action} disposal must remain idempotent`);
  }
});

test("dispose waits for an acknowledged first prompt to become durable", async () => {
  const { RpcSessionHost } = await import("../src/rpc/RpcSessionHost");
  let acceptStarted!: () => void;
  let finishAccept!: () => void;
  const started = new Promise<void>((resolve) => { acceptStarted = resolve; });
  const finish = new Promise<void>((resolve) => { finishAccept = resolve; });
  let acceptedFinished = false;
  let rejected = 0;
  const host = new RpcSessionHost({
    cwd: process.cwd(),
    kind: "work",
    executable: process.execPath,
    args: [fixturePath],
    label: "Accepted first prompt close race",
    parity: {
      name: "dzialki-work",
      provider: "anthropic",
      modelId: "claude-opus-5",
      thinkingLevel: "xhigh",
      cwd: process.cwd(),
      requiredTools: fixtureTools,
      allowedTools: fixtureTools,
      forbiddenTools: [],
    },
    logger: { info() {}, error() {}, show() {}, dispose() {} },
    onStatusChange() {},
    onTitleChange: () => false,
    onSessionFileChange() {},
    onLoopHandoff() {},
    async onFirstPromptAccepted() {
      acceptStarted();
      await finish;
      acceptedFinished = true;
    },
    onFirstPromptRejected() { rejected += 1; },
  });
  host.attachWebview({ postMessage: async () => true } as never, "accept-close");
  await host.handleWebviewMessage({ type: "ready" });
  const prompt = host.handleWebviewMessage({
    type: "prompt",
    message: "acknowledge then hold ownership",
    images: [],
  });
  await started;
  let disposed = false;
  const closing = host.dispose().then(() => { disposed = true; });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(disposed, false, "close must wait for durable ownership callback");
  finishAccept();
  await Promise.all([prompt, closing]);
  assert.equal(acceptedFinished, true);
  assert.equal(rejected, 0, "acknowledged prompt must never return to unused");
});

test("an OMP crash while awaiting first output never strands the waiting state", async () => {
  const [{ RpcSessionHost }, { applyHostFrame, createInitialWebviewState }] =
    await Promise.all([
      import("../src/rpc/RpcSessionHost"),
      import("../src/rpc/webviewState"),
    ]);
  const posts: Record<string, unknown>[] = [];
  const host = new RpcSessionHost({
    cwd: process.cwd(),
    kind: "work",
    executable: process.execPath,
    args: [fixturePath, "--die-after-prompt"],
    label: "Crash while waiting",
    parity: {
      name: "dzialki-work",
      provider: "anthropic",
      modelId: "claude-opus-5",
      thinkingLevel: "xhigh",
      cwd: process.cwd(),
      requiredTools: fixtureTools,
      allowedTools: fixtureTools,
      forbiddenTools: [],
    },
    responseStartWaitMs: 30,
    responseStartTimeoutMs: 150,
    logger: { info() {}, error() {}, show() {}, dispose() {} },
    onStatusChange() {},
    onTitleChange: () => false,
    onSessionFileChange() {},
    onLoopHandoff() {},
  });
  host.attachWebview(
    {
      postMessage: async (message: Record<string, unknown>) => {
        posts.push(message);
        return true;
      },
    } as never,
    "crash-while-waiting",
  );

  try {
    await host.handleWebviewMessage({ type: "ready" });
    await host.handleWebviewMessage({
      type: "prompt",
      message: "ask something the agent never answers",
      images: [],
    });
    await waitFor(() =>
      posts.some((frame) => frame.type === "responseWaiting"),
    );
    await waitFor(() =>
      posts.some(
        (frame) =>
          frame.type === "transport" &&
          (frame.status === "failed" || frame.status === "exited"),
      ),
    );
    // Let the response-start deadline pass with the process already gone.
    await new Promise((resolve) => setTimeout(resolve, 250));

    // Replay exactly what the host told the webview. Whatever retires the
    // spinner, the sidebar must not be left waiting on a dead session.
    let state = createInitialWebviewState();
    let sawWaiting = false;
    for (const frame of posts) {
      state = applyHostFrame(state, frame);
      if (state.runtime.responseWaiting) sawWaiting = true;
    }
    assert.equal(sawWaiting, true, "test is void unless the spinner appeared");
    assert.equal(
      state.runtime.responseWaiting,
      false,
      "a dead OMP session must not leave 'Still waiting for Opus 5' on screen",
    );
    assert.ok(
      state.notices.some((notice) => notice.level === "error"),
      "the crash must still surface an error notice",
    );
  } finally {
    await host.dispose();
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for host teardown");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
