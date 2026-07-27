import assert from "node:assert/strict";
import test from "node:test";

import { classifyPreParityFrame } from "../src/rpc/preParity";

test("all extension UI requests fail closed before parity", () => {
  for (const method of ["open_url", "setTitle", "set_editor_text", "confirm"]) {
    assert.equal(
      classifyPreParityFrame({ type: "extension_ui_request", method }),
      "reject-ui",
    );
  }
  assert.equal(classifyPreParityFrame({ type: "message_start" }), "buffer");
  assert.equal(
    classifyPreParityFrame({
      type: "extension_ui_request",
      method: "setStatus",
    }),
    "buffer",
  );
});
