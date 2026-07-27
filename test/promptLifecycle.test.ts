import assert from "node:assert/strict";
import test from "node:test";

import { PromptLifecycle } from "../src/rpc/promptLifecycle";

test("late same-id prompt failure restores exact draft", () => {
  const lifecycle = new PromptLifecycle();
  lifecycle.begin("prompt-1", "Do exact work");
  assert.equal(lifecycle.fail("prompt-1"), "Do exact work");
  assert.equal(lifecycle.fail("prompt-1"), undefined);
});

test("nonterminal continuation retains prompt until terminal completion", () => {
  const lifecycle = new PromptLifecycle();
  lifecycle.begin("prompt-1", "Continue loop");
  lifecycle.agentEnded(false);
  assert.equal(lifecycle.has("prompt-1"), true);
  lifecycle.agentEnded(true);
  assert.equal(lifecycle.has("prompt-1"), false);
});
