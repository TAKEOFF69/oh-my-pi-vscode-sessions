import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  extractLoopHandoffAlias,
  LoopHandoffSingleFlight,
  sameLoopAlias,
} from "../src/loopHandoff";

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

describe("Loop handoff coordination", () => {
  it("matches immutable aliases independently of mutable display titles", () => {
    assert.equal(sameLoopAlias("Professionals-Loop", "professionals-loop"), true);
    assert.equal(sameLoopAlias(undefined, "professionals-loop"), false);
  });

  it("serializes same-alias handoffs and permits retry after completion", async () => {
    const flights = new LoopHandoffSingleFlight<string>();
    let starts = 0;
    let release: ((value: string) => void) | undefined;
    const start = () => {
      starts += 1;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    };

    const first = flights.joinOrStart("Loop-A", start);
    const second = flights.joinOrStart("loop-a", start);
    assert.equal(first.started, true);
    assert.equal(second.started, false);
    assert.equal(first.promise, second.promise);
    assert.equal(starts, 0);

    await Promise.resolve();
    assert.equal(starts, 1);
    release?.("opened");
    assert.equal(await second.promise, "opened");
    await Promise.resolve();

    const retry = flights.joinOrStart("loop-a", async () => "focused");
    assert.equal(retry.started, true);
    assert.equal(await retry.promise, "focused");
  });

  it("clears failed flights without creating an unhandled rejection", async () => {
    const flights = new LoopHandoffSingleFlight<string>();
    const failed = flights.joinOrStart("loop-b", async () => {
      throw new Error("launch failed");
    });
    await assert.rejects(failed.promise, /launch failed/);
    await Promise.resolve();

    const retry = flights.joinOrStart("loop-b", async () => "recovered");
    assert.equal(retry.started, true);
    assert.equal(await retry.promise, "recovered");
  });
});
