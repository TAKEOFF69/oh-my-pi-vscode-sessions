import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import * as nodePath from "node:path";

export type GitWorktree = {
  path: string;
  head?: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
  prunable: boolean;
};

export type GitRepositoryIdentity = {
  root: string;
  commonDir: string;
  origin?: string;
};

export async function listGitWorktrees(cwd: string): Promise<GitWorktree[]> {
  try {
    const stdout = await runGit(cwd, ["worktree", "list", "--porcelain"]);
    return parseWorktreePorcelain(stdout);
  } catch {
    return [];
  }
}

export function parseWorktreePorcelain(output: string): GitWorktree[] {
  const records: GitWorktree[] = [];
  let current: GitWorktree | undefined;

  const flush = (): void => {
    if (current) {
      records.push(current);
      current = undefined;
    }
  };

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) {
      flush();
      continue;
    }

    const separator = line.indexOf(" ");
    const key = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? "" : line.slice(separator + 1);

    if (key === "worktree") {
      flush();
      current = {
        path: nodePath.normalize(value),
        bare: false,
        detached: false,
        prunable: false,
      };
      continue;
    }

    if (!current) {
      continue;
    }

    switch (key) {
      case "HEAD":
        current.head = value;
        break;
      case "branch":
        current.branch = value.replace(/^refs\/heads\//, "");
        break;
      case "bare":
        current.bare = true;
        break;
      case "detached":
        current.detached = true;
        break;
      case "prunable":
        current.prunable = true;
        break;
    }
  }

  flush();
  return records;
}

export function sameDirectory(left: string, right: string): boolean {
  const a = nodePath.resolve(left);
  const b = nodePath.resolve(right);
  return process.platform === "win32"
    ? a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0
    : a === b;
}

export async function resolveSessionPath(
  filePath: string,
  targetCwd: string,
): Promise<string | undefined> {
  const direct = containedRelative(targetCwd, filePath);
  if (direct !== undefined) {
    return direct || nodePath.basename(filePath);
  }

  const [source, target] = await Promise.all([
    repositoryIdentity(nodePath.dirname(filePath)),
    repositoryIdentity(targetCwd),
  ]);
  if (!source || !target) {
    return undefined;
  }
  return mapPathBetweenWorktrees(filePath, source, target);
}

export function mapPathBetweenWorktrees(
  filePath: string,
  source: GitRepositoryIdentity,
  target: GitRepositoryIdentity,
  pathExists: (candidate: string) => boolean = existsSync,
): string | undefined {
  if (!sameDirectory(source.commonDir, target.commonDir)) {
    return undefined;
  }
  const relative = containedRelative(source.root, filePath);
  if (relative === undefined || !relative) {
    return undefined;
  }
  const mapped = nodePath.resolve(target.root, relative);
  if (
    containedRelative(target.root, mapped) === undefined ||
    !pathExists(mapped)
  ) {
    return undefined;
  }
  return relative;
}

export async function repositoryIdentity(
  cwd: string,
): Promise<GitRepositoryIdentity | undefined> {
  try {
    const root = (await runGit(cwd, ["rev-parse", "--show-toplevel"])).trim();
    const commonDir = (
      await runGit(root, [
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir",
      ])
    ).trim();
    if (!root || !commonDir) {
      return undefined;
    }
    let origin: string | undefined;
    try {
      origin = (await runGit(root, ["remote", "get-url", "origin"])).trim();
    } catch {
      origin = undefined;
    }
    return {
      root: nodePath.resolve(root),
      commonDir: nodePath.resolve(commonDir),
      ...(origin ? { origin } : {}),
    };
  } catch {
    return undefined;
  }
}

function containedRelative(root: string, candidate: string): string | undefined {
  const relative = nodePath.relative(
    nodePath.resolve(root),
    nodePath.resolve(candidate),
  );
  if (
    relative === ".." ||
    relative.startsWith(`..${nodePath.sep}`) ||
    nodePath.isAbsolute(relative)
  ) {
    return undefined;
  }
  return relative;
}

function runGit(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", cwd, ...args],
      {
        cwd,
        encoding: "utf8",
        timeout: 7_500,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}
