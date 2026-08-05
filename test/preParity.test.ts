import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPreParityFrame,
  enforceToolApprovalTripwire,
  isNativeToolApprovalRequest,
  shouldFailClosedToolApproval,
} from "../src/rpc/preParity";

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

test("native tool approvals are distinct from ordinary extension UI", () => {
  assert.equal(
    isNativeToolApprovalRequest({
      type: "extension_ui_request",
      method: "select",
      title: "Allow tool: bash",
      options: ["Approve", "Deny"],
    }),
    true,
  );
  assert.equal(
    isNativeToolApprovalRequest({
      type: "extension_ui_request",
      method: "input",
      title: "Choose a branch",
    }),
    false,
  );
  assert.equal(
    isNativeToolApprovalRequest({
      type: "extension_ui_request",
      method: "confirm",
      title: "Delete generated cache?",
    }),
    false,
  );
  const approval = {
    type: "extension_ui_request",
    method: "select",
    title: "Allow tool: bash",
  } as const;
  assert.equal(shouldFailClosedToolApproval("dzialki-work", approval), true);
  assert.equal(shouldFailClosedToolApproval("dzialki-loop", approval), true);
  assert.equal(shouldFailClosedToolApproval("generic-work", approval), false);
});

test("trusted approval tripwire cancels then blocks while generic stays interactive", () => {
  const approval = {
    type: "extension_ui_request",
    id: "approval-1",
    method: "select",
    title: "Allow tool: bash",
  } as const;
  const events: string[] = [];
  assert.equal(
    enforceToolApprovalTripwire("dzialki-work", approval, {
      cancel: (frame) => events.push(`cancel:${frame.id}`),
      block: (detail) => events.push(`block:${detail}`),
    }),
    true,
  );
  assert.deepEqual(events.map((event) => event.split(":", 1)[0]), [
    "cancel",
    "block",
  ]);
  events.length = 0;
  assert.equal(
    enforceToolApprovalTripwire("generic-work", approval, {
      cancel: () => events.push("cancel"),
      block: () => events.push("block"),
    }),
    false,
  );
  assert.deepEqual(events, []);
});
