import assert from "node:assert/strict";
import * as nodePath from "node:path";
import { describe, it } from "node:test";

import { provisionDzialkiWorktree } from "../src/dzialkiWorktree";

describe("Dzialkopedia automatic worktree provisioning", () => {
  it("uses extension-owned Git operations and validates fresh origin/main", async () => {
    const root = nodePath.resolve("C:/repo");
    const expectedCwd = nodePath.join(
      nodePath.dirname(root),
      "dzialki-wt-20260728-omp-session-fixed",
    );
    const expectedBranch = "wip/20260728-omp-session-fixed";
    const commands: Array<{ cwd: string; args: readonly string[] }> = [];
    let validated = false;
    let bootstrapped = false;

    const result = await provisionDzialkiWorktree(root, "work", {
      suffix: () => "fixed",
      dateStamp: () => "20260728",
      pathExists: () => false,
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

    assert.deepEqual(result, {
      cwd: expectedCwd,
      branch: expectedBranch,
    });
    assert.equal(validated, true);
    assert.equal(bootstrapped, true);
    assert.deepEqual(commands[0].args, ["fetch", "origin", "main"]);
    assert.deepEqual(commands[1].args, [
      "ls-remote",
      "--heads",
      "origin",
      expectedBranch,
    ]);
    assert.deepEqual(commands[2].args, [
      "worktree",
      "add",
      "-b",
      expectedBranch,
      expectedCwd,
      "origin/main",
    ]);
    assert.equal(
      commands.some(({ args }) => args[0] === "config"),
      true,
    );
    assert.equal(
      commands.some(({ args }) => args.includes("agent:start")),
      false,
    );
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
});
