import assert from "node:assert/strict";
import test from "node:test";

import { TeardownBarrier } from "../src/rpc/teardownBarrier";

test("restart gate cannot pass until detached teardown finishes", async () => {
  const barrier = new TeardownBarrier();
  let release!: () => void;
  const delayedExit = new Promise<void>((resolve) => {
    release = resolve;
  });
  let restarted = false;

  void barrier.enqueue(() => delayedExit);
  const restart = (async () => {
    await barrier.wait();
    restarted = true;
  })();

  await Promise.resolve();
  assert.equal(restarted, false);
  release();
  await restart;
  assert.equal(restarted, true);
});

test("failed teardown keeps restart gate closed", async () => {
  const barrier = new TeardownBarrier();
  const failure = new Error("old process tree survived");
  void barrier.enqueue(async () => {
    throw failure;
  }).catch(() => undefined);

  await assert.rejects(() => barrier.wait(), failure);
});
