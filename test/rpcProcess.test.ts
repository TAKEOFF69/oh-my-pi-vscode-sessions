import assert from "node:assert/strict";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { RpcProcess, type RpcFrame } from "../src/rpc/RpcProcess";

const fixturePath = fileURLToPath(
  new URL("./fixtures/fake-omp-rpc.mjs", import.meta.url),
);

test("RPC process negotiates, correlates requests, streams, and exits cleanly", async () => {
  const rpc = new RpcProcess({
    executable: process.execPath,
    args: [fixturePath],
    cwd: process.cwd(),
    startupTimeoutMs: 5_000,
    requestTimeoutMs: 5_000,
  });
  const frames: RpcFrame[] = [];
  rpc.on("frame", (frame: RpcFrame) => frames.push(frame));

  const ready = await rpc.start();
  assert.deepEqual(ready.supportedProtocolVersions, [1, 2]);

  const state = await rpc.request({ type: "get_state" });
  assert.equal(state.success, true);
  assert.deepEqual(
    (state.data as { model: unknown }).model,
    { provider: "anthropic", id: "claude-opus-5" },
  );

  const prompt = await rpc.request({
    type: "prompt",
    message: "Exercise lifecycle",
  });
  assert.equal(prompt.success, true);
  assert.deepEqual(
    frames
      .filter((frame) =>
        [
          "agent_start",
          "message_start",
          "tool_execution_start",
          "tool_execution_end",
          "message_end",
          "agent_end",
        ].includes(frame.type),
      )
      .map((frame) => frame.type),
    [
      "agent_start",
      "message_start",
      "tool_execution_start",
      "tool_execution_end",
      "message_end",
      "agent_end",
    ],
  );
  assert.ok(
    frames.some(
      (frame) =>
        frame.type === "extension_ui_request" &&
        frame.id === "confirm-1",
    ),
  );

  const uiAck = waitForFrame(
    rpc,
    (frame) =>
      frame.type === "extension_ui_ack" &&
      frame.id === "confirm-1",
  );
  rpc.send({
    type: "extension_ui_response",
    id: "confirm-1",
    confirmed: true,
  });
  assert.equal((await uiAck).confirmed, true);
  assert.equal(
    (await rpc.request({ type: "steer", message: "Narrow scope" })).success,
    true,
  );
  assert.equal((await rpc.request({ type: "abort" })).success, true);

  const exited = once(rpc, "exit");
  await rpc.request({ type: "shutdown" });
  const [{ code }] = (await exited) as [{ code: number | null }];
  assert.equal(code, 0);
  await rpc.dispose();
});

test("two RPC processes remain independently addressable", async () => {
  const first = new RpcProcess({
    executable: process.execPath,
    args: [fixturePath],
    cwd: process.cwd(),
    startupTimeoutMs: 5_000,
    requestTimeoutMs: 5_000,
  });
  const second = new RpcProcess({
    executable: process.execPath,
    args: [fixturePath],
    cwd: process.cwd(),
    startupTimeoutMs: 5_000,
    requestTimeoutMs: 5_000,
  });
  await Promise.all([first.start(), second.start()]);
  const [firstState, secondState] = await Promise.all([
    first.request({ type: "get_state" }),
    second.request({ type: "get_state" }),
  ]);
  assert.notEqual(
    (firstState.data as { sessionId: string }).sessionId,
    (secondState.data as { sessionId: string }).sessionId,
  );
  assert.equal(first.running, true);
  assert.equal(second.running, true);

  const firstExited = once(first, "exit");
  const secondExited = once(second, "exit");
  await Promise.all([
    first.request({ type: "shutdown" }),
    second.request({ type: "shutdown" }),
  ]);
  await Promise.all([firstExited, secondExited]);
  await Promise.all([first.dispose(), second.dispose()]);
});

test("RPC process rejects incomplete v2 handshakes", async () => {
  for (const mode of ["--bad-ready", "--bad-negotiation"]) {
    const rpc = new RpcProcess({
      executable: process.execPath,
      args: [fixturePath, mode],
      cwd: process.cwd(),
      startupTimeoutMs: 5_000,
      requestTimeoutMs: 5_000,
    });
    await assert.rejects(() => rpc.start(), /protocolVersion 2|maxFrameBytes/);
    await rpc.dispose();
  }
});

test("same-id late failure remains observable after accepted response", async () => {
  const rpc = new RpcProcess({
    executable: process.execPath,
    args: [fixturePath],
    cwd: process.cwd(),
    startupTimeoutMs: 5_000,
    requestTimeoutMs: 5_000,
  });
  await rpc.start();
  const late = waitForFrame(
    rpc,
    (frame) =>
      frame.type === "response" &&
      frame.id === "prompt-explicit" &&
      frame.success === false,
  );
  const accepted = await rpc.request({
    type: "late_fail_prompt",
    id: "prompt-explicit",
    message: "keep this draft",
  });
  assert.equal(accepted.id, "prompt-explicit");
  assert.equal((await late).error, "late queue rejection");
  await rpc.dispose();
});

test("dispose resolves only after child process exits", async () => {
  const rpc = new RpcProcess({
    executable: process.execPath,
    args: [fixturePath],
    cwd: process.cwd(),
    startupTimeoutMs: 5_000,
    requestTimeoutMs: 5_000,
  });
  await rpc.start();
  const exited = once(rpc, "exit");
  await rpc.dispose();
  await exited;
  assert.equal(rpc.running, false);
});

test("dispose reaps the complete spawned process tree", async () => {
  const rpc = new RpcProcess({
    executable: process.execPath,
    args: [fixturePath, "--spawn-descendant"],
    cwd: process.cwd(),
    startupTimeoutMs: 5_000,
    requestTimeoutMs: 5_000,
  });
  const descendantFrame = waitForFrame(
    rpc,
    (frame) => frame.type === "fixture_descendant",
  );
  await rpc.start();
  const descendantPid = Number((await descendantFrame).pid);
  assert.equal(Number.isSafeInteger(descendantPid), true);
  assert.equal(processAlive(descendantPid), true);

  await rpc.dispose();

  assert.equal(await waitForProcessGone(descendantPid, 2_000), true);
});

function waitForFrame(
  rpc: RpcProcess,
  predicate: (frame: RpcFrame) => boolean,
): Promise<RpcFrame> {
  return new Promise((resolve) => {
    const listener = (frame: RpcFrame) => {
      if (!predicate(frame)) {
        return;
      }
      rpc.off("frame", listener);
      resolve(frame);
    };
    rpc.on("frame", listener);
  });
}

async function waitForProcessGone(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processAlive(pid);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
