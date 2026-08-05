import assert from "node:assert/strict";
import test from "node:test";

import { ambientMcpMounts } from "../src/rpc/mcpMountGate";

test("finds ambient MCP devices only in runtime inventory notices", () => {
  assert.deepEqual(
    ambientMcpMounts({
      type: "response",
      command: "get_messages",
      data: {
        messages: [{
          role: "assistant",
          customType: "xdev-mount-notice",
          content: "- xd://mcp__telegram_send\n- xd://mcp_mind_search",
        }],
      },
    }),
    ["mcp__telegram_send", "mcp_mind_search"],
  );
});

test("does not treat a user's quoted device name as runtime inventory", () => {
  assert.deepEqual(
    ambientMcpMounts({
      type: "message_end",
      message: { role: "user", content: "Why did xd://mcp__telegram_send appear?" },
    }),
    [],
  );
});
