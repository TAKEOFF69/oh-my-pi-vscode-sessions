import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import {
  copyFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import * as nodePath from "node:path";

export type DzialkiWorktreeRole = "work" | "loop";

export type ProvisionedDzialkiWorktree = {
  cwd: string;
  branch: string;
  fetchedMainSha?: string;
  fetchedAtMs?: number;
  ephemeralCleanupToken?: string;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

type ProvisionOptions = {
  runGit?: (
    cwd: string,
    args: readonly string[],
  ) => Promise<CommandResult>;
  suffix?: () => string;
  dateStamp?: () => string;
  pathExists?: (candidate: string) => boolean;
  bootstrap?: (
    sourceRoot: string,
    targetRoot: string,
  ) => Promise<void>;
  validate?: (
    worktree: ProvisionedDzialkiWorktree,
  ) => Promise<void>;
  reportPhase?: (phase: string, elapsedMs: number) => void;
  baseRef?: string;
  fetchOriginMain?: boolean;
  configureHooks?: boolean;
  ephemeralCleanupToken?: string;
  writeEphemeralMarker?: (
    cwd: string,
    marker: Readonly<Record<string, unknown>>,
  ) => Promise<void>;
};

export async function provisionGitWorktree(
  repositoryRoot: string,
  role: DzialkiWorktreeRole,
  options: ProvisionOptions = {},
): Promise<ProvisionedDzialkiWorktree> {
  const prefix = role === "loop" ? "omp-loop-session" : "omp-session";
  const suffix =
    options.suffix?.() ??
    `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/i.test(suffix)) {
    throw new Error("Generated OMP worktree suffix is invalid");
  }

  const stamp = options.dateStamp?.() ?? utcDateStamp();
  const arc = `${prefix}-${suffix}`;
  const branch = `wip/${stamp}-${arc}`;
  const repositoryName = nodePath
    .basename(repositoryRoot)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "repository";
  const cwd = nodePath.join(
    nodePath.dirname(repositoryRoot),
    `${repositoryName}-wt-${stamp}-${arc}`,
  );
  const pathExists = options.pathExists ?? existsSync;
  if (pathExists(cwd)) {
    throw new Error(`Isolated OMP worktree path already exists: ${cwd}`);
  }

  const runGit = options.runGit ?? runGitCommand;
  const baseRef = options.baseRef ?? "origin/main";
  const fetchOriginMain = options.fetchOriginMain ?? true;
  const runPhase = async <T>(
    phase: string,
    action: () => Promise<T>,
  ): Promise<T> => {
    const startedAt = Date.now();
    try {
      return await action();
    } finally {
      options.reportPhase?.(phase, Date.now() - startedAt);
    }
  };
  let created = false;
  let bootstrapStarted = false;
  let expectedHead = "";
  let fetchedAtMs: number | undefined;
  try {
    if (fetchOriginMain) {
      await runPhase("fetch origin/main", () =>
        runGit(repositoryRoot, ["fetch", "origin", "main"]),
      );
      fetchedAtMs = Date.now();
    }
    const resolvedHead = await runPhase("resolve base ref", () =>
      runGit(repositoryRoot, ["rev-parse", baseRef]),
    );
    expectedHead = resolvedHead.stdout.trim();
    if (!expectedHead) {
      throw new Error(`OMP worktree base ref does not resolve: ${baseRef}`);
    }
    await runPhase("create worktree", () =>
      runGit(repositoryRoot, [
        "-c",
        "checkout.workers=4",
        "-c",
        "checkout.thresholdForParallelism=100",
        "worktree",
        "add",
        "-b",
        branch,
        cwd,
        baseRef,
      ]),
    );
    created = true;

    const [actualBranch, head, status] =
      await runPhase("verify worktree", () =>
        Promise.all([
          runGit(cwd, ["branch", "--show-current"]),
          runGit(cwd, ["rev-parse", "HEAD"]),
          runGit(cwd, [
            "status",
            "--porcelain",
            "--untracked-files=no",
          ]),
        ]),
      );
    if (
      actualBranch.stdout.trim() !== branch ||
      head.stdout.trim() !== expectedHead ||
      status.stdout.trim()
    ) {
      throw new Error(
        `Fresh OMP worktree did not match clean ${baseRef}`,
      );
    }

    const worktree = { cwd, branch };
    await runPhase("validate adapter", async () => {
      await options.validate?.(worktree);
    });
    await runPhase("bootstrap worktree", async () => {
      bootstrapStarted = true;
      if (
        options.configureHooks === true &&
        pathExists(nodePath.join(cwd, ".githooks"))
      ) {
        await runGit(cwd, [
          "config",
          "core.hooksPath",
          ".githooks",
        ]);
      }
      await (options.bootstrap ?? bootstrapWorktree)(
        repositoryRoot,
        cwd,
      );
      if (options.ephemeralCleanupToken) {
        const marker = {
            schema: 1,
            token: options.ephemeralCleanupToken,
            branch,
            baseSha: expectedHead,
            createdAt: new Date().toISOString(),
            phase: "unused",
        };
        if (options.writeEphemeralMarker) {
          await options.writeEphemeralMarker(cwd, marker);
        } else {
          await writeFile(
            nodePath.join(cwd, ".agent-omp-ephemeral.json"),
            `${JSON.stringify(marker)}\n`,
            { encoding: "utf8", flag: "wx" },
          );
        }
      }
    });
    return {
      ...worktree,
      ...(fetchOriginMain
        ? { fetchedMainSha: expectedHead, fetchedAtMs }
        : {}),
      ...(options.ephemeralCleanupToken
        ? { ephemeralCleanupToken: options.ephemeralCleanupToken }
        : {}),
    };
  } catch (error) {
    if (created && !bootstrapStarted) {
      try {
        await cleanupFailedProvision(
          repositoryRoot,
          cwd,
          branch,
          expectedHead,
          runGit,
        );
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "OMP worktree provisioning failed and exact cleanup could not be completed",
        );
      }
    }
    if (created && bootstrapStarted) {
      throw new AggregateError(
        [error],
        `OMP bootstrap failed; partial worktree was preserved for safe inspection: ${cwd}`,
      );
    }
    throw error;
  }
}

export const provisionDzialkiWorktree = provisionGitWorktree;

export async function bootstrapWorktree(
  sourceRoot: string,
  targetRoot: string,
): Promise<void> {
  for (const relative of [
    "node_modules",
    nodePath.join("apps", "web", "node_modules"),
  ]) {
    const source = nodePath.join(sourceRoot, relative);
    const target = nodePath.join(targetRoot, relative);
    if (!existsSync(source) || existsSync(target)) {
      continue;
    }
    await symlink(
      source,
      target,
      process.platform === "win32" ? "junction" : "dir",
    );
  }

  for (const relative of ["", nodePath.join("apps", "web")]) {
    const sourceDirectory = nodePath.join(sourceRoot, relative);
    if (!existsSync(sourceDirectory)) {
      continue;
    }
    const entries = await readdir(sourceDirectory, {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith(".env")) {
        continue;
      }
      const target = nodePath.join(
        targetRoot,
        relative,
        entry.name,
      );
      if (existsSync(target)) {
        continue;
      }
      await copyFile(
        nodePath.join(sourceDirectory, entry.name),
        target,
      );
    }
  }

  await writeFile(
    nodePath.join(targetRoot, ".agent-alive"),
    new Date().toISOString(),
  );
}

async function cleanupFailedProvision(
  repositoryRoot: string,
  cwd: string,
  branch: string,
  expectedHead: string,
  runGit: (
    cwd: string,
    args: readonly string[],
  ) => Promise<CommandResult>,
): Promise<void> {
  const [actualBranch, head, status] =
    await Promise.all([
    runGit(cwd, ["branch", "--show-current"]),
    runGit(cwd, ["rev-parse", "HEAD"]),
    runGit(cwd, [
      "status",
      "--porcelain",
    ]),
  ]);
  if (
    actualBranch.stdout.trim() !== branch ||
    head.stdout.trim() !== expectedHead ||
    status.stdout.trim()
  ) {
    throw new Error(
      "Refused cleanup because failed OMP worktree changed after creation",
    );
  }
  await runGit(repositoryRoot, [
    "worktree",
    "remove",
    cwd,
  ]);
  await runGit(repositoryRoot, [
    "update-ref",
    "-d",
    `refs/heads/${branch}`,
    head.stdout.trim(),
  ]);
}

function utcDateStamp(): string {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function runGitCommand(
  cwd: string,
  args: readonly string[],
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(
      "git",
      ["-C", cwd, ...args],
      {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
      },
    );
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let outputExceeded = false;
    let termination: Promise<void> | undefined;

    const finish = (
      callback: () => void,
    ): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        callback();
      }
    };
    const append = (
      current: string,
      chunk: Buffer,
    ): string => {
      const next = current + chunk.toString("utf8");
      if (next.length > 4 * 1024 * 1024) {
        if (!outputExceeded) {
          outputExceeded = true;
          termination ??= terminateProcessTree(child);
          void termination.then(
            () => {
              finish(() =>
                reject(new Error("Git command exceeded output limit")),
              );
            },
            (error) => {
              finish(() =>
                reject(
                  error instanceof Error
                    ? error
                    : new Error(String(error)),
                ),
              );
            },
          );
        }
        return current;
      }
      return next;
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.once("error", (error) => {
      finish(() => reject(error));
    });
    child.once("close", (code, signal) => {
      void (async () => {
        if (termination) {
          await termination;
        }
        finish(() => {
          if (timedOut) {
            reject(
              new Error(
                "Git command timed out after process tree was reaped",
              ),
            );
          } else if (code !== 0) {
            const detail = (stderr || stdout).trim().slice(0, 800);
            reject(
              new Error(
                detail ||
                  `Git command exited ${String(code)}${signal ? ` (${signal})` : ""}`,
              ),
            );
          } else {
            resolve({ stdout, stderr });
          }
        });
      })().catch((error) => {
        finish(() =>
          reject(
            error instanceof Error ? error : new Error(String(error)),
          ),
        );
      });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      termination ??= terminateProcessTree(child);
      void termination.catch((error) => {
        finish(() =>
          reject(
            error instanceof Error ? error : new Error(String(error)),
          ),
        );
      });
    }, 120_000);
  });
}

async function terminateProcessTree(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    const killer = spawn(
      "taskkill.exe",
      ["/pid", String(child.pid), "/t", "/f"],
      { stdio: "ignore", windowsHide: true },
    );
    const killed = await waitForClose(killer, 5_000);
    if (
      killed !== 0 &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      throw new Error(`Could not terminate Git process tree ${child.pid}`);
    }
    if (!(await waitForExit(child, 5_000))) {
      throw new Error(`Could not reap Git process tree ${child.pid}`);
    }
    return;
  }

  signalGroup(child.pid, "SIGTERM");
  if (!(await waitForGroupExit(child.pid, 3_000))) {
    signalGroup(child.pid, "SIGKILL");
    if (!(await waitForGroupExit(child.pid, 5_000))) {
      throw new Error(`Could not reap Git process group ${child.pid}`);
    }
  }
  if (!(await waitForExit(child, 1_000))) {
    throw new Error(`Could not reap Git root process ${child.pid}`);
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

async function waitForGroupExit(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        return true;
      }
    }
    await delay(50);
  }
  return false;
}

function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

function waitForClose(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(child.exitCode);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Process terminator timed out"));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
