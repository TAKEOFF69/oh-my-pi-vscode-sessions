import assert from "node:assert/strict";
import * as nodePath from "node:path";
import { describe, it } from "node:test";

import {
  mapPathBetweenWorktrees,
  parseWorktreePorcelain,
  sameDirectory,
} from "../src/worktrees";

describe("parseWorktreePorcelain", () => {
  it("parses branches, detached worktrees, and paths with spaces", () => {
    const output = [
      "worktree C:/repo with spaces",
      "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "branch refs/heads/main",
      "",
      "worktree C:/repo-wt",
      "HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "detached",
      "",
    ].join("\n");

    const worktrees = parseWorktreePorcelain(output);
    assert.equal(worktrees.length, 2);
    assert.equal(worktrees[0]?.branch, "main");
    assert.match(worktrees[0]?.path ?? "", /repo with spaces$/);
    assert.equal(worktrees[1]?.detached, true);
  });

  it("marks prunable and bare records", () => {
    const output = [
      "worktree C:/bare",
      "bare",
      "",
      "worktree C:/old",
      "HEAD cccccccccccccccccccccccccccccccccccccccc",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\n");

    const worktrees = parseWorktreePorcelain(output);
    assert.equal(worktrees[0]?.bare, true);
    assert.equal(worktrees[1]?.prunable, true);
  });
});

describe("sameDirectory", () => {
  it("normalizes equivalent paths", () => {
    assert.equal(sameDirectory("a/../b", "b"), true);
  });
});

describe("mapPathBetweenWorktrees", () => {
  const commonDir = nodePath.resolve("C:/repo/.git");
  const source = {
    root: nodePath.resolve("C:/repo"),
    commonDir,
  };
  const target = {
    root: nodePath.resolve("C:/repo-wt-feature"),
    commonDir,
  };

  it("maps same-repository files to a target-relative path", () => {
    const result = mapPathBetweenWorktrees(
      nodePath.join(source.root, "src", "page.tsx"),
      source,
      target,
      (candidate) =>
        sameDirectory(
          candidate,
          nodePath.join(target.root, "src", "page.tsx"),
        ),
    );
    assert.equal(result, nodePath.join("src", "page.tsx"));
  });

  it("rejects another repository and missing target files", () => {
    assert.equal(
      mapPathBetweenWorktrees(
        nodePath.join(source.root, "src", "page.tsx"),
        source,
        { ...target, commonDir: nodePath.resolve("C:/other/.git") },
        () => true,
      ),
      undefined,
    );
    assert.equal(
      mapPathBetweenWorktrees(
        nodePath.join(source.root, "src", "page.tsx"),
        source,
        target,
        () => false,
      ),
      undefined,
    );
  });
});
