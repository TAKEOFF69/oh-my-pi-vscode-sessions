import { execFile } from "node:child_process";
import * as nodePath from "node:path";

export type GitWorktree = {
  path: string;
  head?: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
  prunable: boolean;
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
