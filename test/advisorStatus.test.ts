import assert from "node:assert/strict";
import test from "node:test";

import { advisorStatusMatches } from "../src/rpc/advisorStatus";

test("advisor status requires the live locked Sol identity", () => {
  assert.equal(advisorStatusMatches("Advisor is enabled (openai-codex/gpt-5.6-sol). Context: 0 tokens."), true);
  assert.equal(advisorStatusMatches("Advisor is disabled."), false);
  assert.equal(advisorStatusMatches("Advisor is enabled (openai-codex/gpt-5.6-luna)."), false);
});
