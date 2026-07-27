import assert from "node:assert/strict";
import test from "node:test";

import {
  loadRpcMessageHistory,
  type RpcRequester,
} from "../src/rpc/messageHistory";
import { RpcCommandError, type RpcResponse } from "../src/rpc/RpcProcess";

test("message history pages to exact total without monolithic frame", async () => {
  const commands: Record<string, unknown>[] = [];
  const requester: RpcRequester = {
    async request(command) {
      commands.push(command);
      const cursor = command.cursor;
      return success("get_messages_page", {
        messages: cursor ? [{ role: "assistant", content: "two" }] : [
          { role: "user", content: "one" },
        ],
        totalMessages: 2,
        nextCursor: cursor ? null : "page-2",
      });
    },
  };
  const response = await loadRpcMessageHistory(requester);
  assert.equal((response.data as { messages: unknown[] }).messages.length, 2);
  assert.deepEqual(commands.map((command) => command.type), [
    "get_messages_page",
    "get_messages_page",
  ]);
});

test("session-busy paging falls back to documented monolithic read", async () => {
  const requester: RpcRequester = {
    async request(command) {
      if (command.type === "get_messages_page") {
        throw new RpcCommandError(
          "get_messages_page",
          "busy",
          "session_busy",
        );
      }
      return success("get_messages", { messages: [] });
    },
  };
  assert.equal((await loadRpcMessageHistory(requester)).command, "get_messages");
});

test("paged history fails closed without required totalMessages", async () => {
  const requester: RpcRequester = {
    async request() {
      return success("get_messages_page", {
        messages: [],
        nextCursor: null,
      });
    },
  };
  await assert.rejects(
    () => loadRpcMessageHistory(requester),
    /invalid totalMessages/,
  );
});

function success(command: string, data: unknown): RpcResponse {
  return {
    type: "response",
    id: `test-${command}`,
    command,
    success: true,
    data,
  };
}
