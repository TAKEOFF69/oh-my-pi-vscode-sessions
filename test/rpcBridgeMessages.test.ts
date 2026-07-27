import assert from "node:assert/strict";
import test from "node:test";

import { parseRpcWebviewMessage } from "../src/rpc/bridgeMessages";

test("RPC webview bridge accepts bounded user actions", () => {
  assert.deepEqual(
    parseRpcWebviewMessage({ type: "prompt", message: "Ship it" }),
    { type: "prompt", message: "Ship it" },
  );
  assert.deepEqual(
    parseRpcWebviewMessage({
      type: "extensionUiResponse",
      id: "ask-1",
      confirmed: true,
    }),
    {
      type: "extensionUiResponse",
      id: "ask-1",
      value: undefined,
      confirmed: true,
      cancelled: undefined,
    },
  );
  assert.deepEqual(
    parseRpcWebviewMessage({
      type: "openFile",
      path: "src/app.ts",
      line: 12.8,
    }),
    { type: "openFile", path: "src/app.ts", line: 12, col: undefined },
  );
});

test("RPC webview bridge rejects empty, oversized, and malformed input", () => {
  assert.equal(
    parseRpcWebviewMessage({ type: "prompt", message: " " }),
    null,
  );
  assert.equal(
    parseRpcWebviewMessage({
      type: "prompt",
      message: "x".repeat(1024 * 1024 + 1),
    }),
    null,
  );
  assert.equal(
    parseRpcWebviewMessage({
      type: "extensionUiResponse",
      id: "",
      confirmed: "yes",
    }),
    null,
  );
  assert.equal(
    parseRpcWebviewMessage({
      type: "openFile",
      path: "",
    }),
    null,
  );
});
