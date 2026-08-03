import assert from "node:assert/strict";
import test from "node:test";
import type * as vscode from "vscode";

import {
  RecentSessionStore,
  type RecentSessionRecord,
} from "../src/sessions/RecentSessionStore";

test("recent session index is bounded, metadata-only, and newest-first", async () => {
  const store = new RecentSessionStore(fakeMemento());
  for (let index = 0; index < 55; index += 1) {
    store.upsert(record(index));
  }
  await store.flush();
  assert.equal(store.list().length, 50);
  assert.equal(store.list()[0]?.id, "session-54");
  assert.equal(store.list().at(-1)?.id, "session-5");
  assert.equal("messages" in (store.list()[0] as object), false);
});

test("recent session index updates title without duplicating identity", async () => {
  const store = new RecentSessionStore(fakeMemento());
  store.upsert(record(1));
  store.upsert({
    ...record(1),
    label: "Manual contextual title",
    titleSource: "manual",
  });
  await store.flush();
  assert.equal(store.list().length, 1);
  assert.equal(store.find("session-1")?.label, "Manual contextual title");
  assert.equal(store.find("session-1")?.titleSource, "manual");
});

function fakeMemento(): vscode.Memento {
  const values = new Map<string, unknown>();
  return {
    get: <T>(key: string, fallback?: T) =>
      (values.has(key) ? values.get(key) : fallback) as T,
    update: async (key: string, value: unknown) => {
      values.set(key, value);
    },
    keys: () => [...values.keys()],
  } as vscode.Memento;
}

function record(index: number): RecentSessionRecord {
  return {
    id: `session-${index}`,
    label: `Context ${index}`,
    cwd: `C:\\worktree-${index}`,
    branch: `wip/context-${index}`,
    kind: "work",
    transport: "rpc",
    sessionFile: `C:\\omp\\session-${index}.jsonl`,
    updatedAt: index,
    titleSource: "provisional",
  };
}
