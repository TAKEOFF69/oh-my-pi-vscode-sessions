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

  it("skips shared Dzialkopedia main and uses dedicated daily driver", () => {
    assert.deepEqual(
      planAutomaticDirectory({
        workspaceRoots: [root],
        worktrees,
        activeWriterCwds: [],
        kind: "work",
        canonicalDzialki: true,
        launcherExists: (cwd) => launcherPaths.has(cwd),
      }),
      {
        action: "use",
        directory: {
          cwd: daily,
          branch: "wip/20260728-omp-daily-driver",
        },
      },
    );
  });

  it("uses dedicated Loop controller without showing worktree picker", () => {
    assert.deepEqual(
      planAutomaticDirectory({
        workspaceRoots: [root],
        worktrees,
        activeWriterCwds: [],
        kind: "loop",
        canonicalDzialki: true,
        launcherExists: (cwd) => launcherPaths.has(cwd),
      }),
      {
        action: "use",
        directory: {
          cwd: loop,
          branch: "wip/20260728-omp-loop-controller",
        },
      },
    );
  });

  it("reuses writer worktree for read-only but never for another writer", () => {
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

    assert.equal(
      planAutomaticDirectory({
        workspaceRoots: [root],
        worktrees,
        activeWriterCwds: [daily],
        kind: "work",
        canonicalDzialki: true,
        launcherExists: (cwd) => launcherPaths.has(cwd),
      }).action,
      "choose",
    );
  });

  it("prefers current eligible Dzialkopedia worktree over dedicated defaults", () => {
    assert.deepEqual(
      planAutomaticDirectory({
        workspaceRoots: [feature],
        worktrees,
        activeWriterCwds: [],
        kind: "work",
        canonicalDzialki: true,
        launcherExists: (cwd) => launcherPaths.has(cwd),
      }),
      {
        action: "use",
        directory: {
          cwd: feature,
          branch: "wip/20260728-feature",
        },
      },
    );
  });
});
