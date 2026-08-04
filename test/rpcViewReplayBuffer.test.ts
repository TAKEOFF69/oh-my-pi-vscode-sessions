import assert from "node:assert/strict";
import test from "node:test";

import { RpcViewReplayBuffer } from "../src/rpc/RpcViewReplayBuffer";

type Frame = {
  type: string;
  id?: string;
  method?: string;
  targetId?: string;
  value?: string;
};

test("rehydration discards pre-history frames and preserves racing live frames", () => {
  const replay = new RpcViewReplayBuffer<Frame>();
  replay.begin(7);
  assert.equal(replay.capture(7, { type: "message_start", value: "old" }), true);
  assert.equal(replay.resetAtHistoryBoundary(7), true);
  replay.capture(7, { type: "message_update", value: "live" });
  assert.deepEqual(replay.drain(7), [
    { type: "message_update", value: "live" },
  ]);
  assert.equal(replay.finish(7), true);
  assert.equal(replay.capture(7, { type: "message_end" }), false);
});

test("only unresolved interactive UI requests survive detach and reattach", () => {
  const replay = new RpcViewReplayBuffer<Frame>();
  replay.observeUiRequest({
    type: "extension_ui_request",
    id: "confirm",
    method: "confirm",
  });
  replay.observeUiRequest({
    type: "extension_ui_request",
    id: "title",
    method: "setTitle",
  });
  assert.deepEqual(replay.pendingUiRequests().map((frame) => frame.id), [
    "confirm",
  ]);
  replay.resolveUiRequest("confirm");
  assert.deepEqual(replay.pendingUiRequests(), []);
});

test("runtime cancellation removes a detached interactive request", () => {
  const replay = new RpcViewReplayBuffer<Frame>();
  replay.observeUiRequest({
    type: "extension_ui_request",
    id: "editor-1",
    method: "editor",
  });
  replay.observeUiRequest({
    type: "extension_ui_request",
    id: "cancel-1",
    method: "cancel",
    targetId: "editor-1",
  });
  assert.deepEqual(replay.pendingUiRequests(), []);
});
