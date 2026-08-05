import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveSessionFile } from "../src/sessionFileResolver";

test("resolves files only inside exact session worktree", () => {
  const cwd = path.join(process.cwd(), "worktrees", "session");
  const expected = path.join(cwd, "src", "app.ts");
  const present = (candidate: string) => candidate === expected;
  assert.equal(resolveSessionFile(cwd, "src/app.ts", present), expected);
  assert.equal(resolveSessionFile(cwd, "../other/src/app.ts", present), undefined);
  assert.equal(resolveSessionFile(cwd, path.join(path.dirname(cwd), "other", "src", "app.ts"), present), undefined);
  assert.equal(resolveSessionFile(cwd, "~/secret.txt", () => true), undefined);
});
