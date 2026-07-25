import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import { test } from "node:test";

import { acquireWriterLeaseAtRoot } from "../src/worktreeLease";

test("writer lease is atomic and token-bound", async () => {
  const leaseRoot = await mkdtemp(
    nodePath.join(os.tmpdir(), "omp-vscode-lease-"),
  );
  try {
    const cwd = nodePath.join(leaseRoot, "worktree");
    const first = await acquireWriterLeaseAtRoot(cwd, "first", leaseRoot);
    assert.equal(first.acquired, true);
    if (!first.acquired) return;

    const second = await acquireWriterLeaseAtRoot(cwd, "second", leaseRoot);
    assert.equal(second.acquired, false);
    if (!second.acquired) {
      assert.equal(second.owner?.label, "first");
    }

    await first.lease.release();
    const third = await acquireWriterLeaseAtRoot(cwd, "third", leaseRoot);
    assert.equal(third.acquired, true);
    if (third.acquired) {
      await third.lease.release();
    }
  } finally {
    await rm(leaseRoot, { recursive: true, force: true });
  }
});
