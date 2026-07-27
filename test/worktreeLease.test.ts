import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import { test } from "node:test";

import {
  acquireWriterLease,
  acquireWriterLeaseAtRoot,
} from "../src/worktreeLease";

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

test("repository root, nested folder, and junction share one writer lease", async () => {
  const temporary = await mkdtemp(
    nodePath.join(os.tmpdir(), "omp-vscode-repo-lease-"),
  );
  const repository = nodePath.join(temporary, "repo");
  const nested = nodePath.join(repository, "apps", "web");
  const junction = nodePath.join(temporary, "repo-link");
  try {
    await mkdir(nested, { recursive: true });
    execFileSync("git", ["init", repository], { stdio: "ignore" });
    await symlink(repository, junction, "junction");

    const first = await acquireWriterLease(repository, "root");
    assert.equal(first.acquired, true);
    if (!first.acquired) return;

    const nestedAttempt = await acquireWriterLease(nested, "nested");
    assert.equal(nestedAttempt.acquired, false);
    const junctionAttempt = await acquireWriterLease(junction, "junction");
    assert.equal(junctionAttempt.acquired, false);

    await first.lease.release();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
