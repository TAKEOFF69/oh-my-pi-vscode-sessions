import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractLoopHandoffAlias } from "../src/loopHandoff";

const validFrame = {
  type: "tool_execution_end",
  toolCallId: "handoff-1",
  toolName: "loop_handoff",
  isError: false,
  result: {
    content: [{ type: "text", text: "handoff requested" }],
    details: {
      protocol: "dzialki-loop-handoff/v1",
      action: "open-loop-controller",
      alias: "professionals-loop",
    },
  },
};

describe("extractLoopHandoffAlias", () => {
  it("accepts only successful validated handoff result", () => {
    assert.equal(
      extractLoopHandoffAlias(validFrame),
      "professionals-loop",
    );
  });

  it("rejects wrong tool, protocol, action, alias, and failed result", () => {
    for (const frame of [
      { ...validFrame, toolName: "read" },
      { ...validFrame, isError: true },
      {
        ...validFrame,
        result: {
          details: {
            ...validFrame.result.details,
            protocol: "unknown/v1",
          },
        },
      },
      {
        ...validFrame,
        result: {
          details: {
            ...validFrame.result.details,
            action: "dispatch-now",
          },
        },
      },
      {
        ...validFrame,
        result: {
          details: {
            ...validFrame.result.details,
            alias: "../escape",
          },
        },
      },
    ]) {
      assert.equal(extractLoopHandoffAlias(frame), undefined);
    }
  });
});
