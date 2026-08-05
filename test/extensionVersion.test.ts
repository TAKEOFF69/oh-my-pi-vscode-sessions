import assert from "node:assert/strict";
import test from "node:test";

import { compareVersions, inspectExtensionVersion } from "../src/extensionVersion";

test("detects newer installed extension without forcing reload", () => {
  const state = inspectExtensionVersion("C:/extensions/old", "2.5.2", () => JSON.stringify([
    { identifier: { id: "takeoff69.oh-my-pi-vscode-sessions" }, version: "2.5.2" },
    { identifier: { id: "takeoff69.oh-my-pi-vscode-sessions" }, version: "2.6.0" },
  ]));
  assert.deepEqual(state, { loaded: "2.5.2", installed: "2.6.0", reloadRequired: true });
  assert.equal(compareVersions("2.6.0", "2.6.0"), 0);
});

test("unknown catalog does not invent mismatch", () => {
  assert.deepEqual(
    inspectExtensionVersion("C:/extensions/current", "2.6.0", () => { throw new Error("missing"); }),
    { loaded: "2.6.0", reloadRequired: false },
  );
});
