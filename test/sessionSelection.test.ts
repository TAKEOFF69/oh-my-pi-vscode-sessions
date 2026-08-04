import assert from "node:assert/strict";
import test from "node:test";

import { clearSessionSelection } from "../src/sessions/sessionSelection";

test("Back clears every hidden command target", () => {
  const states = [true, false];
  const sessions = states.map((_state, index) => ({
    setActive(active: boolean) {
      states[index] = active;
    },
  }));
  const active = clearSessionSelection(sessions);
  assert.equal(active, undefined);
  assert.deepEqual(states, [false, false]);
});
