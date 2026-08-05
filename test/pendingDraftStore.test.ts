import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";

import { PendingDraftStore } from "../src/sidebar/PendingDraftStore";

test("pending draft survives host recreation byte-for-byte until matching ack", async () => {
  const memento = fakeMemento();
  const image = { type: "image" as const, mimeType: "image/png" as const, data: "iVBORw==" };
  const first = new PendingDraftStore(memento, 1000);
  await first.save({ token: "one", message: "inspect", images: [image], updatedAt: 1000 });
  assert.deepEqual(new PendingDraftStore(memento, 1001).load(), {
    token: "one", message: "inspect", images: [image], updatedAt: 1000,
  });
  assert.equal(await first.clear("wrong"), false);
  assert.ok(first.load());
  assert.equal(await first.clear("one"), true);
  assert.equal(first.load(), undefined);
});

test("expired pending screenshots are discarded", () => {
  const now = 2 * 24 * 60 * 60 * 1000;
  const memento = fakeMemento({
    "ohMyPiSessions.pendingDraft.v1": {
      token: "old", message: "old", images: [], updatedAt: 1,
    },
  });
  assert.equal(new PendingDraftStore(memento, now).load(), undefined);
});

function fakeMemento(initial: Record<string, unknown> = {}): vscode.Memento {
  const values = new Map(Object.entries(initial));
  return {
    get: <T>(key: string, fallback?: T) => (values.has(key) ? values.get(key) : fallback) as T,
    update: async (key: string, value: unknown) => { values.set(key, value); },
    keys: () => [...values.keys()],
  } as vscode.Memento;
}
