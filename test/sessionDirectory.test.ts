import assert from "node:assert/strict";
import * as nodePath from "node:path";
import { describe, it } from "node:test";

import { planAutomaticDirectory } from "../src/sessionDirectory";
import type { GitWorktree } from "../src/worktrees";

const root = nodePath.resolve("C:/repo");
const daily = nodePath.resolve("C:/repo-wt-omp-daily");
const loop = nodePath.resolve("C:/repo-wt-omp-loop");
const feature = nodePath.resolve("C:/repo-wt-feature");

const worktrees: GitWorktree[] = [
  {
    path: root,
    branch: "main",
    bare: false,
    detached: false,
    prunable: false,
  },
  {
    path: daily,
    branch: "wip/20260728-omp-daily-driver",
    bare: false,
    detached: false,
    prunable: false,
  },
  {
    path: loop,
    branch: "wip/20260728-omp-loop-controller",
    bare: false,
    detached: false,
    prunable: false,
  },
  {
    path: feature,
    branch: "wip/20260728-feature",
    bare: false,
    detached: false,
    prunable: false,
  },
];

const launcherPaths = new Set([daily, loop, feature]);

describe("planAutomaticDirectory", () => {
  it("uses current folder directly for a generic project", () => {
    assert.deepEqual(
      planAutomaticDirectory({
        workspaceRoots: [root],
        worktrees,
        activeWriterCwds: [],
        kind: "work",
        canonicalDzialki: false,
        launcherExists: () => false,
      }),
      { action: "use", directory: { cwd: root, branch: "main" } },
    );
  });

  it("skips shared Dzialkopedia main and provisions a fresh writer", () => {
    assert.deepEqual(
      planAutomaticDirectory({
        workspaceRoots: [root],
        worktrees,
        activeWriterCwds: [],
        kind: "work",
        canonicalDzialki: true,
        launcherExists: (cwd) => launcherPaths.has(cwd),
      }),
      { action: "create", role: "work" },
    );
  });

  it("provisions a fresh Loop controller without showing worktree picker", () => {
    assert.deepEqual(
      planAutomaticDirectory({
        workspaceRoots: [root],
        worktrees,
        activeWriterCwds: [],
        kind: "loop",
        canonicalDzialki: true,
        launcherExists: (cwd) => launcherPaths.has(cwd),
      }),
      { action: "create", role: "loop" },
    );
  });

  it("reuses writer worktree for read-only and provisions isolation for another writer", () => {
    const readonly = planAutomaticDirectory({
      workspaceRoots: [root],
      worktrees,
      activeWriterCwds: [daily],
      kind: "readonly",
      canonicalDzialki: true,
      launcherExists: (cwd) => launcherPaths.has(cwd),
    });
    assert.equal(readonly.action, "use");
    if (readonly.action === "use") {
      assert.equal(readonly.directory.cwd, daily);
    }

    assert.deepEqual(
      planAutomaticDirectory({
        workspaceRoots: [root],
        worktrees,
        activeWriterCwds: [daily],
        kind: "work",
        canonicalDzialki: true,
        launcherExists: (cwd) => launcherPaths.has(cwd),
      }),
      { action: "create", role: "work" },
    );
  });

  it("never silently reuses an idle extension-managed writer worktree", () => {
    const managed = nodePath.resolve("C:/repo-wt-omp-session-abc");
    assert.deepEqual(
      planAutomaticDirectory({
        workspaceRoots: [root],
        worktrees: [
          ...worktrees,
          {
            path: managed,
            branch: "wip/20260728-omp-session-abc",
            bare: false,
            detached: false,
            prunable: false,
          },
        ],
        activeWriterCwds: [daily],
        kind: "work",
        canonicalDzialki: true,
        launcherExists: (cwd) =>
          launcherPaths.has(cwd) || cwd === managed,
      }),
      { action: "create", role: "work" },
    );
  });

  it("provisions another controller when dedicated Loop worktree is occupied", () => {
    assert.deepEqual(
      planAutomaticDirectory({
        workspaceRoots: [root],
        worktrees,
        activeWriterCwds: [loop],
        kind: "loop",
        canonicalDzialki: true,
        launcherExists: (cwd) => launcherPaths.has(cwd),
      }),
      { action: "create", role: "loop" },
    );
  });

  it("keeps explicit Dzialkopedia branch selection behind advanced command", () => {
    assert.deepEqual(
      planAutomaticDirectory({
        workspaceRoots: [feature],
        worktrees,
        activeWriterCwds: [],
        kind: "work",
        canonicalDzialki: true,
        launcherExists: (cwd) => launcherPaths.has(cwd),
      }),
      { action: "create", role: "work" },
    );
  });
});
