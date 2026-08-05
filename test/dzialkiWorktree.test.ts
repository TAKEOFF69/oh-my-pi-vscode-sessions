import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import { describe, it } from "node:test";

import {
  bootstrapWorktree,
  provisionDzialkiWorktree,
  provisionGitWorktree,
} from "../src/dzialkiWorktree";

describe("Dzialkopedia automatic worktree provisioning", () => {
  it("copies missing local env without overwriting canonical tracked files", async () => {
    const root = await mkdtemp(
      nodePath.join(os.tmpdir(), "omp-bootstrap-source-"),
    );
    const target = await mkdtemp(
      nodePath.join(os.tmpdir(), "omp-bootstrap-target-"),
    );
    try {
      await mkdir(nodePath.join(root, "apps", "web"), {
        recursive: true,
      });
      await mkdir(nodePath.join(target, "apps", "web"), {
        recursive: true,
      });
      await writeFile(
        nodePath.join(root, ".env.example"),
        "stale lobby\n",
      );
      await writeFile(
        nodePath.join(target, ".env.example"),
        "canonical worktree\n",
      );
      await writeFile(
        nodePath.join(root, ".env.local"),
        "SECRET=test\n",
      );

      await bootstrapWorktree(root, target);

      assert.equal(
        await readFile(
          nodePath.join(target, ".env.example"),
          "utf8",
        ),
        "canonical worktree\n",
      );
      assert.equal(
        await readFile(
          nodePath.join(target, ".env.local"),
          "utf8",
        ),
        "SECRET=test\n",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(target, { recursive: true, force: true });
    }
  });

  it("uses extension-owned Git operations and validates fresh origin/main", async () => {
    const root = nodePath.resolve("C:/repo");
    const expectedCwd = nodePath.join(
      nodePath.dirname(root),
      "repo-wt-20260728-omp-session-fixed",
    );
    const expectedBranch = "wip/20260728-omp-session-fixed";
    const commands: Array<{ cwd: string; args: readonly string[] }> = [];
    let validated = false;
    let bootstrapped = false;
    let ephemeralMarker: Readonly<Record<string, unknown>> | undefined;

    const result = await provisionDzialkiWorktree(root, "work", {
      suffix: () => "fixed",
      dateStamp: () => "20260728",
      configureHooks: true,
      ephemeralCleanupToken: "123e4567-e89b-12d3-a456-426614174000",
      writeEphemeralMarker: async (cwd, marker) => {
        assert.equal(cwd, expectedCwd);
        ephemeralMarker = marker;
      },
      pathExists: (candidate) => candidate.endsWith(".githooks"),
      runGit: async (cwd, args) => {
        commands.push({ cwd, args });
        const joined = args.join(" ");
        if (joined === "branch --show-current") {
          return { stdout: `${expectedBranch}\n`, stderr: "" };
        }
        if (joined === "rev-parse HEAD" || joined === "rev-parse origin/main") {
          return { stdout: "abc123\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      },
      validate: async (worktree) => {
        assert.deepEqual(worktree, {
          cwd: expectedCwd,
          branch: expectedBranch,
        });
        validated = true;
      },
      bootstrap: async (source, target) => {
        assert.equal(source, root);
        assert.equal(target, expectedCwd);
        bootstrapped = true;
      },
    });

    assert.equal(result.cwd, expectedCwd);
    assert.equal(result.branch, expectedBranch);
    assert.equal(result.fetchedMainSha, "abc123");
    assert.equal(typeof result.fetchedAtMs, "number");
    assert.equal(
      result.ephemeralCleanupToken,
      "123e4567-e89b-12d3-a456-426614174000",
    );
    assert.equal(ephemeralMarker?.branch, expectedBranch);
    assert.equal(ephemeralMarker?.phase, "unused");
    assert.equal(validated, true);
    assert.equal(bootstrapped, true);
    assert.deepEqual(commands[0].args, ["fetch", "origin", "main"]);
    assert.deepEqual(commands[1].args, ["rev-parse", "origin/main"]);
    assert.deepEqual(commands[2].args, [
      "-c",
      "checkout.workers=4",
      "-c",
      "checkout.thresholdForParallelism=100",
      "worktree",
      "add",
      "-b",
      expectedBranch,
      expectedCwd,
      "origin/main",
    ]);
    assert.equal(
      commands.some(({ args }) => args[0] === "ls-remote"),
      false,
    );
    assert.equal(
      commands.some(({ args }) => args[0] === "config"),
      true,
    );
    assert.equal(
      commands.some(({ args }) => args.includes("agent:start")),
      false,
    );
  });

  it("creates generic writer from local HEAD without fetch or bootstrap copying", async () => {
    const root = nodePath.resolve("C:/generic-repo");
    const commands: string[][] = [];
    let bootstrapCalls = 0;
    const result = await provisionGitWorktree(root, "work", {
      suffix: () => "generic",
      dateStamp: () => "20260804",
      pathExists: () => false,
      baseRef: "HEAD",
      fetchOriginMain: false,
      runGit: async (_cwd, args) => {
        commands.push([...args]);
        const joined = args.join(" ");
        if (joined === "branch --show-current") {
          return {
            stdout: "wip/20260804-omp-session-generic\n",
            stderr: "",
          };
        }
        if (joined === "rev-parse HEAD") {
          return { stdout: "abc123\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      },
      bootstrap: async () => {
        bootstrapCalls += 1;
      },
    });

    assert.equal(result.branch, "wip/20260804-omp-session-generic");
    assert.equal(commands.some((args) => args[0] === "fetch"), false);
    assert.equal(commands.some((args) => args[0] === "config"), false);
    assert.deepEqual(commands[0], ["rev-parse", "HEAD"]);
    assert.equal(commands[1].at(-1), "HEAD");
    assert.equal(bootstrapCalls, 1);
  });

  it("removes exact fresh worktree when validation fails", async () => {
    const root = nodePath.resolve("C:/repo");
    const commands: string[][] = [];
    await assert.rejects(
      provisionDzialkiWorktree(root, "loop", {
        suffix: () => "fixed",
        dateStamp: () => "20260728",
        pathExists: () => false,
        runGit: async (_cwd, args) => {
          commands.push([...args]);
          const joined = args.join(" ");
          if (joined === "branch --show-current") {
            return {
              stdout: "wip/20260728-omp-loop-session-fixed\n",
              stderr: "",
            };
          }
          if (
            joined === "rev-parse HEAD" ||
            joined === "rev-parse origin/main"
          ) {
            return { stdout: "abc123\n", stderr: "" };
          }
          return { stdout: "", stderr: "" };
        },
        validate: async () => {
          throw new Error("not canonical");
        },
        bootstrap: async () => undefined,
      }),
      /not canonical/,
    );
    assert.equal(
      commands.some(
        (args) =>
          args[0] === "worktree" &&
          args[1] === "remove" &&
          args.length === 3,
      ),
      true,
    );
    assert.equal(
      commands.some(
        (args) => args[0] === "update-ref" && args[1] === "-d",
      ),
      true,
    );
  });

  it("preserves failed worktree when any untracked file appears", async () => {
    const root = nodePath.resolve("C:/repo");
    const commands: string[][] = [];
    let statusCalls = 0;
    await assert.rejects(
      provisionDzialkiWorktree(root, "work", {
        suffix: () => "untracked",
        dateStamp: () => "20260728",
        pathExists: () => false,
        runGit: async (_cwd, args) => {
          commands.push([...args]);
          const joined = args.join(" ");
          if (joined === "branch --show-current") {
            return {
              stdout: "wip/20260728-omp-session-untracked\n",
              stderr: "",
            };
          }
          if (
            joined === "rev-parse HEAD" ||
            joined === "rev-parse origin/main"
          ) {
            return { stdout: "abc123\n", stderr: "" };
          }
          if (args[0] === "status") {
            statusCalls += 1;
            return {
              stdout: statusCalls === 1 ? "" : "?? surprise.txt\n",
              stderr: "",
            };
          }
          return { stdout: "", stderr: "" };
        },
        validate: async () => {
          throw new Error("not canonical");
        },
        bootstrap: async () => undefined,
      }),
      /cleanup could not be completed/,
    );
    assert.equal(
      commands.some(
        (args) => args[0] === "worktree" && args[1] === "remove",
      ),
      false,
    );
    assert.equal(
      commands.some((args) => args[0] === "update-ref"),
      false,
    );
  });

  it("never removes a worktree after bootstrap begins", async () => {
    const commands: string[][] = [];
    await assert.rejects(
      provisionDzialkiWorktree(nodePath.resolve("C:/repo"), "work", {
        suffix: () => "bootstrap-fail",
        dateStamp: () => "20260804",
        pathExists: () => false,
        runGit: async (_cwd, args) => {
          commands.push([...args]);
          const joined = args.join(" ");
          if (joined === "branch --show-current") {
            return {
              stdout: "wip/20260804-omp-session-bootstrap-fail\n",
              stderr: "",
            };
          }
          if (joined === "rev-parse HEAD" || joined === "rev-parse origin/main") {
            return { stdout: "abc123\n", stderr: "" };
          }
          return { stdout: "", stderr: "" };
        },
        bootstrap: async () => {
          throw new Error("junction setup failed");
        },
      }),
      /partial worktree was preserved/,
    );
    assert.equal(
      commands.some(
        (args) => args[0] === "worktree" && args[1] === "remove",
      ),
      false,
    );
  });
});
