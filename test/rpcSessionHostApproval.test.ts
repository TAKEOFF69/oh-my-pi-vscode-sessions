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
    await genericHost.handleWebviewMessage({
      type: "prompt",
      message: "run generic approval probe",
      images: [],
    });
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

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for host teardown");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
