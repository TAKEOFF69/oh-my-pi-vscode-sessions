import assert from "node:assert/strict";
import test from "node:test";

import { InitialPromptOwnership } from "../src/rpc/initialPromptOwnership";

test("startup prompt transfers exactly once to OMP", () => {
  const ownership = new InitialPromptOwnership("build the chat home");

  assert.deepEqual(ownership.claimForDelivery(), {
    message: "build the chat home",
    images: [],
  });
  assert.equal(ownership.state, "delivered");
  assert.equal(ownership.claimForDelivery(), undefined);
  assert.equal(ownership.claimForRestore(), undefined);
});

test("startup failure restores once and restart cannot auto-send", () => {
  const ownership = new InitialPromptOwnership("keep this exact draft");

  assert.deepEqual(ownership.claimForRestore(), {
    message: "keep this exact draft",
    images: [],
  });
  assert.equal(ownership.state, "restored");
  assert.equal(ownership.claimForRestore(), undefined);
  assert.equal(ownership.claimForDelivery(), undefined);
});

test("startup screenshot transfers with its prompt exactly once", () => {
  const image = {
    type: "image",
    mimeType: "image/png",
    data: "iVBORw==",
  } as const;
  const ownership = new InitialPromptOwnership("inspect this", [image]);

  assert.deepEqual(ownership.claimForDelivery(), {
    message: "inspect this",
    images: [image],
  });
  assert.equal(ownership.claimForRestore(), undefined);
});

test("empty startup has no transferable prompt", () => {
  const ownership = new InitialPromptOwnership();

  assert.equal(ownership.state, "none");
  assert.equal(ownership.claimForDelivery(), undefined);
  assert.equal(ownership.claimForRestore(), undefined);
});
