import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSidebarWebviewMessage,
  SidebarFocusQueue,
} from "../src/sidebar/messages";

test("sidebar bridge accepts one bounded first prompt and session focus", () => {
  assert.deepEqual(
    parseSidebarWebviewMessage({ type: "createSession", prompt: "  Inspect RCN  " }),
    { type: "createSession", prompt: "  Inspect RCN  " },
  );
  assert.deepEqual(
    parseSidebarWebviewMessage({ type: "focusSession", id: "session-1" }),
    { type: "focusSession", id: "session-1" },
  );
  assert.deepEqual(parseSidebarWebviewMessage({ type: "ready" }), {
    type: "ready",
  });
});

test("focus intent is consumed once and stale failed delivery cannot wipe later draft", () => {
  const queue = new SidebarFocusQueue();
  const stale = queue.begin(true, true);
  const latest = queue.begin(false, false);
  queue.deliveryFailed(stale);
  assert.deepEqual(queue.consumePending(), latest);
  assert.equal(queue.consumePending(), undefined);
});

test("sidebar bridge rejects empty, oversized, and malformed creation", () => {
  assert.equal(
    parseSidebarWebviewMessage({ type: "createSession", prompt: "  " }),
    null,
  );
  assert.equal(
    parseSidebarWebviewMessage({
      type: "createSession",
      prompt: "x".repeat(1024 * 1024 + 1),
    }),
    null,
  );
  assert.equal(
    parseSidebarWebviewMessage({ type: "focusSession", id: "x".repeat(129) }),
    null,
  );
  assert.equal(parseSidebarWebviewMessage({ type: "spawnAgain" }), null);
});
