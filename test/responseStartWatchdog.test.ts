import assert from "node:assert/strict";
import test from "node:test";

import {
  isProviderOverloadFrame,
  isSemanticResponseFrame,
  ResponseStartWatchdog,
  shouldWatchResponseStart,
  type ResponseStartScheduler,
} from "../src/rpc/responseStartWatchdog";

function fakeScheduler(): {
  scheduler: ResponseStartScheduler;
  run(delayMs: number): void;
  pending(): number;
} {
  let sequence = 0;
  const tasks = new Map<number, { delayMs: number; callback: () => void }>();
  return {
    scheduler: {
      set(delayMs, callback) {
        const handle = ++sequence;
        tasks.set(handle, { delayMs, callback });
        return handle;
      },
      clear(handle) {
        tasks.delete(Number(handle));
      },
    },
    run(delayMs) {
      for (const [handle, task] of [...tasks]) {
        if (task.delayMs !== delayMs) continue;
        tasks.delete(handle);
        task.callback();
      }
    },
    pending: () => tasks.size,
  };
}

test("response-start watchdog surfaces waiting state then abort deadline", () => {
  const clock = fakeScheduler();
  const events: string[] = [];
  const watchdog = new ResponseStartWatchdog({
    waitMs: 12_000,
    timeoutMs: 20_000,
    scheduler: clock.scheduler,
    onWaiting: () => events.push("waiting"),
    onTimeout: () => events.push("timeout"),
  });

  watchdog.arm();
  clock.run(12_000);
  assert.deepEqual(events, ["waiting"]);
  clock.run(20_000);
  assert.deepEqual(events, ["waiting", "timeout"]);
  assert.equal(clock.pending(), 0);
});

test("semantic output cancels both response-start deadlines", () => {
  const clock = fakeScheduler();
  const events: string[] = [];
  const watchdog = new ResponseStartWatchdog({
    waitMs: 12_000,
    timeoutMs: 20_000,
    scheduler: clock.scheduler,
    onWaiting: () => events.push("waiting"),
    onTimeout: () => events.push("timeout"),
  });

  watchdog.arm();
  watchdog.observe({
    type: "message_update",
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking: "Inspecting history" }],
    },
  });
  clock.run(12_000);
  clock.run(20_000);
  assert.deepEqual(events, []);
  assert.equal(clock.pending(), 0);
});

test("runtime status chatter does not disguise a missing provider response", () => {
  assert.equal(
    isSemanticResponseFrame({
      type: "extension_ui_request",
      method: "setStatus",
      statusKey: "dzialki-model-lock",
      statusText: "Opus 5 · xhigh · locked",
    }),
    false,
  );
  assert.equal(
    isSemanticResponseFrame({
      type: "message_update",
      message: {
        role: "custom",
        customType: "advisor",
        content: "Checking policy",
      },
    }),
    false,
  );
  assert.equal(
    isSemanticResponseFrame({
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "read",
    }),
    true,
  );
});

test("watchdog and overload interception are limited to exact Dzialki work sessions", () => {
  assert.equal(shouldWatchResponseStart("dzialki-work", "work", "prompt", false), true);
  assert.equal(shouldWatchResponseStart("dzialki-loop", "loop", "prompt", false), false);
  assert.equal(shouldWatchResponseStart("dzialki-work", "work", "follow_up", true), false);
  assert.equal(shouldWatchResponseStart("generic", "work", "prompt", false), false);
  // An idle session waits for first output the same way whatever the send
  // button said; only an already-streaming turn is outside this SLA.
  assert.equal(shouldWatchResponseStart("dzialki-work", "work", "follow_up", false), true);
  assert.equal(shouldWatchResponseStart("dzialki-work", "work", "steer", false), true);
  assert.equal(shouldWatchResponseStart("dzialki-work", "work", "steer", true), false);
  assert.equal(shouldWatchResponseStart("dzialki-loop", "loop", "follow_up", false), false);

  assert.equal(
    isProviderOverloadFrame({
      type: "auto_retry_start",
      errorMessage: "Anthropic stream error (overloaded_error): Overloaded",
    }),
    true,
  );
  assert.equal(
    isProviderOverloadFrame({
      type: "auto_retry_start",
      errorMessage: "rate limited",
    }),
    false,
  );
});
