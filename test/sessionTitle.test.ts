import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveSessionTitle,
  infrastructureTitle,
  normalizeRuntimeSessionTitle,
  shouldAcceptSessionTitle,
} from "../src/sessionTitle";

test("derives concise contextual titles from first meaningful prompt", () => {
  assert.equal(
    deriveSessionTitle(
      "Can you inspect the RCN pipeline session and recover its progress?",
    ),
    "Inspect the RCN pipeline session and recover its progress",
  );
  assert.equal(
    deriveSessionTitle("[OMP docs](https://example.test) please fix resume"),
    "OMP docs please fix resume",
  );
  assert.equal(
    deriveSessionTitle("Look at this. Please make the OMP sidebar like Codex."),
    "Make the OMP sidebar like Codex",
  );
  assert.equal(
    deriveSessionTitle("/loop-start dzialkagpt-consumer"),
    "Loop: dzialkagpt consumer",
  );
  assert.equal(
    deriveSessionTitle("Sprawdź polskie znaki i popraw nawigację sesji"),
    "Sprawdź polskie znaki i popraw nawigację sesji",
  );
  assert.equal(
    deriveSessionTitle("hi this is my first omp session - are u alive?"),
    "Test OMP session",
  );
});

test("only durable session metadata can refine automatic title", () => {
  assert.equal(shouldAcceptSessionTitle("provisional", "transient"), false);
  assert.equal(shouldAcceptSessionTitle("runtime", "transient"), false);
  assert.equal(shouldAcceptSessionTitle("provisional", "session"), true);
  assert.equal(shouldAcceptSessionTitle("manual", "session"), false);
});

test("never accepts infrastructure identity as chat title", () => {
  const branch = "wip/20260803-omp-session-msdinax4-9d4d16";
  const cwd = "C:\\worktrees\\dzialki-wt-20260803-omp-session-msdinax4-9d4d16";
  assert.equal(infrastructureTitle(branch, branch, cwd), true);
  assert.equal(infrastructureTitle(cwd, branch, cwd), true);
  assert.equal(normalizeRuntimeSessionTitle(branch, branch, cwd), undefined);
  assert.equal(
    normalizeRuntimeSessionTitle("Recover RCN classifier", branch, cwd),
    "Recover RCN classifier",
  );
});

test("caps long prompt titles without cutting through final word", () => {
  const title = deriveSessionTitle(
    "Investigate an exceptionally long startup regression involving duplicated worktree provisioning and repeated RPC process launches",
  );
  assert.ok(title.length <= 64);
  assert.ok(title.split(/\s+/).length <= 10);
});
