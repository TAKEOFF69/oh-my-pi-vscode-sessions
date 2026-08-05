import assert from "node:assert/strict";
import test from "node:test";

import { PromptLifecycle } from "../src/rpc/promptLifecycle";

test("late same-id prompt failure restores exact draft", () => {
  const lifecycle = new PromptLifecycle();
  lifecycle.begin("prompt-1", "Do exact work");
  assert.deepEqual(lifecycle.fail("prompt-1"), {
    message: "Do exact work",
    images: [],
  });
  assert.equal(lifecycle.fail("prompt-1"), undefined);
});

test("failed prompt restores screenshot with exact text", () => {
  const lifecycle = new PromptLifecycle();
  const image = {
    type: "image",
    mimeType: "image/png",
    data: "iVBORw==",
  } as const;
  lifecycle.begin("prompt-1", "Inspect this", [image]);
  assert.deepEqual(lifecycle.fail("prompt-1"), {
    message: "Inspect this",
    images: [image],
  });
});

test("nonterminal continuation retains prompt until terminal completion", () => {
  const lifecycle = new PromptLifecycle();
  lifecycle.begin("prompt-1", "Continue loop");
  lifecycle.agentEnded(false);
  assert.equal(lifecycle.has("prompt-1"), true);
  lifecycle.agentEnded(true);
  assert.equal(lifecycle.has("prompt-1"), false);
});
