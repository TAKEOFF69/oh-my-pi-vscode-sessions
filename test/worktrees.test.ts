import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
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
