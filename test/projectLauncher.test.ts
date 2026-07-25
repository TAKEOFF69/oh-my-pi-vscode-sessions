import assert from "node:assert/strict";
import * as nodePath from "node:path";
import { test } from "node:test";

import { detectProjectLauncher } from "../src/projectLauncher";

test("selected worktree launcher outranks lobby workspace settings", () => {
  const cwd = nodePath.resolve("C:/repo-worktree");
  const expected = nodePath.join(cwd, "scripts", "omp", "launch.mjs");
  assert.deepEqual(
    detectProjectLauncher(cwd, (candidate) => candidate === expected),
    {
      executable: "node scripts/omp/launch.mjs",
      readOnlyArgument: "--read-only",
    },
  );
  assert.equal(detectProjectLauncher(cwd, () => false), undefined);
});
