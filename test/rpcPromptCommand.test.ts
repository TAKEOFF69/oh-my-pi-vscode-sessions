import assert from "node:assert/strict";
import test from "node:test";

import { buildRpcPromptCommand } from "../src/rpc/promptCommand";

test("RPC prompt forwards screenshot in canonical OMP ImageContent shape", () => {
  const image = {
    type: "image",
    mimeType: "image/png",
    data: "iVBORw==",
  } as const;

  assert.deepEqual(
    buildRpcPromptCommand(
      "prompt",
      "prompt-1",
      "Inspect screenshot",
      [image],
      false,
    ),
    {
      type: "prompt",
      id: "prompt-1",
      message: "Inspect screenshot",
      images: [image],
    },
  );
  assert.deepEqual(
    buildRpcPromptCommand("steer", "prompt-2", "Use this", [image], true),
    {
      type: "steer",
      id: "prompt-2",
      message: "Use this",
      images: [image],
    },
  );
});

test("text-only prompt keeps the legacy compact RPC shape", () => {
  assert.deepEqual(
    buildRpcPromptCommand("prompt", "prompt-1", "Ship it", [], true),
    {
      type: "prompt",
      id: "prompt-1",
      message: "Ship it",
      streamingBehavior: "followUp",
    },
  );
});
