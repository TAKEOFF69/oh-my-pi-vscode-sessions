import assert from "node:assert/strict";
import test from "node:test";

import {
  messageMatchesSurface,
  tagSurfaceMessage,
} from "../src/sidebar/surfaceRouting";

test("stale sidebar documents cannot address newly selected session", () => {
  assert.equal(
    messageMatchesSurface(
      { type: "prompt", message: "stale", surfaceToken: "surface-a" },
      "surface-b",
    ),
    false,
  );
  assert.equal(
    messageMatchesSurface(
      { type: "prompt", message: "current", surfaceToken: "surface-b" },
      "surface-b",
    ),
    true,
  );
  assert.equal(messageMatchesSurface({ type: "ready" }, "surface-b"), false);
  assert.deepEqual(
    tagSurfaceMessage({ type: "rpc", frame: { type: "notice" } }, "surface-a"),
    {
      type: "rpc",
      frame: { type: "notice" },
      surfaceToken: "surface-a",
    },
  );
  assert.equal(
    messageMatchesSurface(
      tagSurfaceMessage({ type: "rpc" }, "surface-a"),
      "surface-b",
    ),
    false,
  );
});
