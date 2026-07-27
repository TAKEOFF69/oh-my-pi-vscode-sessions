import assert from "node:assert/strict";
import test from "node:test";

import {
  PtySession,
  restartPtyAfterTeardown,
} from "../src/terminal/ptySession";

test("PTY dispose waits for complete descendant process-tree exit", async () => {
  const session = new PtySession();
  let output = "";
  let resolvePid!: (pid: number) => void;
  const descendantPid = new Promise<number>((resolve) => {
    resolvePid = resolve;
  });
  session.spawn({
    executable: process.execPath,
    args: [
      "-e",
      [
        'const {spawn}=require("node:child_process");',
        'const childCode="if(process.platform!==\\\"win32\\\")process.on(\\\"SIGHUP\\\",()=>{});setInterval(()=>{},1000)";',
        'const c=spawn(process.execPath,["-e",childCode],{stdio:"ignore"});',
        'process.stdout.write(`DESCENDANT=${c.pid}\\n`);',
        "setInterval(()=>{},1000);",
      ].join(""),
    ],
    cwd: process.cwd(),
    cols: 80,
    rows: 24,
    onData(data) {
      output += data;
      const match = output.match(/DESCENDANT=(\d+)/);
      if (match) {
        resolvePid(Number(match[1]));
      }
    },
    onExit() {},
  });
  let pid: number | undefined;
  try {
    pid = await withTimeout(descendantPid, 5_000);
    assert.equal(processAlive(pid), true);

    await Promise.all([session.dispose(), session.dispose()]);

    assert.equal(await waitForProcessGone(pid, 2_000), true);
  } finally {
    await session.dispose();
    if (pid && processAlive(pid)) {
      process.kill(pid);
    }
  }
});

test("close during PTY restart prevents post-close respawn", async () => {
  let release!: () => void;
  const delayedTeardown = new Promise<void>((resolve) => {
    release = resolve;
  });
  let disposed = false;
  let respawned = false;
  const restart = restartPtyAfterTeardown(
    () => delayedTeardown,
    () => disposed,
    () => {
      respawned = true;
    },
  );

  disposed = true;
  release();
  await restart;

  assert.equal(respawned, false);
});

async function waitForProcessGone(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return true;
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

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("PTY fixture produced no PID")),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
