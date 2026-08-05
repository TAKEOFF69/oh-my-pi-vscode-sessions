import assert from "node:assert/strict";
import test from "node:test";

import { resolveSessionFile } from "../src/sessionFileResolver";

test("resolves files only inside exact session worktree", () => {
  const cwd = "C:\\worktrees\\session";
  const present = (candidate: string) => candidate.endsWith("src\\app.ts");
  assert.equal(resolveSessionFile(cwd, "src/app.ts", present), "C:\\worktrees\\session\\src\\app.ts");
  assert.equal(resolveSessionFile(cwd, "../other/src/app.ts", present), undefined);
  assert.equal(resolveSessionFile(cwd, "C:\\workspace\\src\\app.ts", present), undefined);
  assert.equal(resolveSessionFile(cwd, "~/secret.txt", () => true), undefined);
});
