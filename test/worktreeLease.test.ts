import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import { test } from "node:test";

import {
  acquireWriterLease,
  acquireWriterLeaseAtRoot,
  inspectActiveWriterLease,
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

test("simultaneous stale-lease reclaimers cannot both acquire", async () => {
  const leaseRoot = await mkdtemp(
    nodePath.join(os.tmpdir(), "omp-vscode-lease-reclaim-"),
  );
  try {
    const cwd = nodePath.join(leaseRoot, "worktree");
    await writeOwner(testTokenLeasePath(cwd, leaseRoot, "stale-owner"), {
      token: "stale-owner",
      pid: 2_147_483_647,
      cwd,
      label: "stale",
      acquiredAt: new Date(0).toISOString(),
    });

    const bothPublished = deferred<void>();
    let published = 0;
    const afterPublish = async () => {
      published += 1;
      if (published === 2) bothPublished.resolve();
      await bothPublished.promise;
    };
    const [first, second] = await Promise.all([
      acquireWriterLeaseAtRoot(cwd, "first", leaseRoot, { afterPublish }),
      acquireWriterLeaseAtRoot(cwd, "second", leaseRoot, { afterPublish }),
    ]);

    const acquired = [first, second].filter((attempt) => attempt.acquired);
    assert.ok(acquired.length <= 1, "at most one concurrent reclaimer owns the worktree");
    for (const attempt of acquired) {
      if (attempt.acquired) await attempt.lease.release();
    }
  } finally {
    await rm(leaseRoot, { recursive: true, force: true });
  }
});

test("a crash-left token is reclaimed without an orphaned barrier", async () => {
  const leaseRoot = await mkdtemp(
    nodePath.join(os.tmpdir(), "omp-vscode-lease-crash-"),
  );
  try {
    const cwd = nodePath.join(leaseRoot, "worktree");
    const stalePath = testTokenLeasePath(cwd, leaseRoot, "crashed-owner");
    await writeOwner(stalePath, {
      token: "crashed-owner",
      pid: 2_147_483_647,
      cwd,
      label: "crashed",
      acquiredAt: new Date(0).toISOString(),
    });

    const attempt = await acquireWriterLeaseAtRoot(cwd, "recovery", leaseRoot);
    assert.equal(attempt.acquired, true);
    await assert.rejects(readFile(stalePath, "utf8"), { code: "ENOENT" });
    if (attempt.acquired) await attempt.lease.release();
  } finally {
    await rm(leaseRoot, { recursive: true, force: true });
  }
});

test("stale cleanup never removes a distinct live token", async () => {
  const leaseRoot = await mkdtemp(
    nodePath.join(os.tmpdir(), "omp-vscode-lease-live-twin-"),
  );
  try {
    const cwd = nodePath.join(leaseRoot, "worktree");
    const stalePath = testTokenLeasePath(cwd, leaseRoot, "stale-owner");
    const livePath = testTokenLeasePath(cwd, leaseRoot, "live-owner");
    await writeOwner(stalePath, {
      token: "stale-owner",
      pid: 2_147_483_647,
      cwd,
      label: "stale",
      acquiredAt: new Date(0).toISOString(),
    });
    const liveOwner = {
      token: "live-owner",
      pid: process.pid,
      cwd,
      label: "live",
      acquiredAt: new Date().toISOString(),
    };
    await writeOwner(livePath, liveOwner);

    const attempt = await acquireWriterLeaseAtRoot(cwd, "reclaimer", leaseRoot);
    assert.equal(attempt.acquired, false);
    assert.deepEqual(JSON.parse(await readFile(livePath, "utf8")), liveOwner);
    await assert.rejects(readFile(stalePath, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(leaseRoot, { recursive: true, force: true });
  }
});

test("legacy mutable lease is preserved and blocks unsafe automatic reclaim", async () => {
  const leaseRoot = await mkdtemp(
    nodePath.join(os.tmpdir(), "omp-vscode-lease-legacy-"),
  );
  try {
    const cwd = nodePath.join(leaseRoot, "worktree");
    const legacyPath = testLegacyLeasePath(cwd, leaseRoot);
    const legacyOwner = {
      token: "legacy-stale-owner",
      pid: 2_147_483_647,
      cwd,
      label: "legacy",
      acquiredAt: new Date(0).toISOString(),
    };
    await writeOwner(legacyPath, legacyOwner);

    const attempt = await acquireWriterLeaseAtRoot(cwd, "new", leaseRoot);
    assert.equal(attempt.acquired, false);
    assert.deepEqual(JSON.parse(await readFile(legacyPath, "utf8")), legacyOwner);
  } finally {
    await rm(leaseRoot, { recursive: true, force: true });
  }
});

test("missing lease inventory after publish fails closed", async () => {
  const leaseRoot = await mkdtemp(
    nodePath.join(os.tmpdir(), "omp-vscode-lease-missing-inventory-"),
  );
  const cwd = nodePath.join(leaseRoot, "worktree");
  const attempt = await acquireWriterLeaseAtRoot(cwd, "writer", leaseRoot, {
    afterPublish: () => rm(leaseRoot, { recursive: true, force: true }),
  });
  assert.equal(attempt.acquired, false);
});

test("lease inventory read error rejects instead of admitting a writer", async () => {
  const leaseRoot = await mkdtemp(
    nodePath.join(os.tmpdir(), "omp-vscode-lease-inventory-error-"),
  );
  const movedRoot = `${leaseRoot}-moved`;
  try {
    const cwd = nodePath.join(leaseRoot, "worktree");
    await assert.rejects(
      acquireWriterLeaseAtRoot(cwd, "writer", leaseRoot, {
        async afterPublish() {
          await rename(leaseRoot, movedRoot);
          await writeFile(leaseRoot, "not a directory\n", "utf8");
        },
      }),
      /ENOTDIR|not a directory/i,
    );
  } finally {
    await rm(leaseRoot, { recursive: true, force: true });
    await rm(movedRoot, { recursive: true, force: true });
  }
});

test("malformed or token-mismatched lease records block and remain preserved", async () => {
  const leaseRoot = await mkdtemp(
    nodePath.join(os.tmpdir(), "omp-vscode-lease-ambiguous-"),
  );
  try {
    const cwd = nodePath.join(leaseRoot, "worktree");
    const malformedPath = testTokenLeasePath(cwd, leaseRoot, "malformed");
    const mismatchedPath = testTokenLeasePath(cwd, leaseRoot, "filename-token");
    await writeFile(malformedPath, "{not-json\n", "utf8");
    await writeOwner(mismatchedPath, {
      token: "different-token",
      pid: process.pid,
      cwd,
      label: "mismatched",
      acquiredAt: new Date().toISOString(),
    });

    const attempt = await acquireWriterLeaseAtRoot(cwd, "writer", leaseRoot);
    assert.equal(attempt.acquired, false);
    assert.equal(await readFile(malformedPath, "utf8"), "{not-json\n");
    assert.equal(
      JSON.parse(await readFile(mismatchedPath, "utf8")).token,
      "different-token",
    );
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
    assert.equal((await inspectActiveWriterLease(repository))?.label, "root");

    const nestedAttempt = await acquireWriterLease(nested, "nested");
    assert.equal(nestedAttempt.acquired, false);
    const junctionAttempt = await acquireWriterLease(junction, "junction");
    assert.equal(junctionAttempt.acquired, false);

    await first.lease.release();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

function testLegacyLeasePath(cwd: string, leaseRoot: string): string {
  return nodePath.join(leaseRoot, `${testLeaseKey(cwd)}.json`);
}

function testTokenLeasePath(
  cwd: string,
  leaseRoot: string,
  token: string,
): string {
  return nodePath.join(leaseRoot, `${testLeaseKey(cwd)}.${token}.json`);
}

function testLeaseKey(cwd: string): string {
  const normalized = nodePath.resolve(cwd);
  const identity =
    process.platform === "win32" ? normalized.toLowerCase() : normalized;
  return createHash("sha256").update(identity).digest("hex");
}

async function writeOwner(
  leasePath: string,
  owner: {
    token: string;
    pid: number;
    cwd: string;
    label: string;
    acquiredAt: string;
  },
): Promise<void> {
  await writeFile(leasePath, `${JSON.stringify(owner)}\n`, "utf8");
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value?: T): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {
    promise,
    resolve(value?: T) {
      resolve(value as T);
    },
  };
}
