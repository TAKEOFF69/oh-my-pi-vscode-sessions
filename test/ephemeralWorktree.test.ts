import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import test from "node:test";

import {
  claimEphemeralWorktree,
  readEphemeralWorktreeMarker,
  releaseEphemeralWorktreeReservation,
  reserveEphemeralWorktree,
} from "../src/ephemeralWorktree";

test("only exact owner can claim an ephemeral worktree", async () => {
  const cwd = await mkdtemp(nodePath.join(os.tmpdir(), "omp-ephemeral-"));
  const marker = nodePath.join(cwd, ".agent-omp-ephemeral.json");
  try {
    const owned = {
      schema: 1,
      token: "123e4567-e89b-12d3-a456-426614174000",
      branch: "wip/20260805-omp-session-abc123",
      baseSha: "a".repeat(40),
      createdAt: "2026-08-05T10:00:00.000Z",
      phase: "unused" as const,
    };
    await writeFile(marker, JSON.stringify(owned));
    assert.deepEqual(await readEphemeralWorktreeMarker(cwd), owned);
    assert.equal(await claimEphemeralWorktree(cwd, "other"), false);
    assert.match(await readFile(marker, "utf8"), /123e4567/);
    assert.equal(await reserveEphemeralWorktree(
      cwd,
      "123e4567-e89b-12d3-a456-426614174000",
    ), true);
    assert.equal((await readEphemeralWorktreeMarker(cwd))?.phase, "prompting");
    assert.equal(await releaseEphemeralWorktreeReservation(
      cwd,
      "123e4567-e89b-12d3-a456-426614174000",
    ), true);
    assert.equal(await reserveEphemeralWorktree(
      cwd,
      "123e4567-e89b-12d3-a456-426614174000",
    ), true);
    assert.equal(
      await claimEphemeralWorktree(
        cwd,
        "123e4567-e89b-12d3-a456-426614174000",
      ),
      true,
    );
    await assert.rejects(readFile(marker, "utf8"), /ENOENT/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
