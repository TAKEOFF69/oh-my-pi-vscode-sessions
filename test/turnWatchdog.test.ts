import assert from "node:assert/strict";
import test from "node:test";

import { isTerminalAssistantMessageEnd } from "../src/rpc/turnWatchdog";

test("arms only after a terminal assistant answer", () => {
  assert.equal(isTerminalAssistantMessageEnd({
    type: "message_end", message: { role: "assistant", stopReason: "stop" },
  }), true);
  assert.equal(isTerminalAssistantMessageEnd({
    type: "message_end", message: { role: "assistant", stopReason: "toolUse" },
  }), false);
  assert.equal(isTerminalAssistantMessageEnd({
    type: "message_end", message: { role: "user", stopReason: "stop" },
  }), false);
});
