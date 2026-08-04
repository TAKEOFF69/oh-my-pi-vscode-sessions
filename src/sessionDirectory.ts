import type { SessionKind } from "./sessions/SessionPanel";
import {
  sameDirectory,
  type GitWorktree,
} from "./worktrees";

export type SessionDirectory = {
  cwd: string;
  branch?: string;
};

export type AutomaticDirectoryPlan =
  | {
      action: "use";
      directory: SessionDirectory;
    }
  | {
      action: "create";
      role: "work" | "loop";
    }
  | {
      action: "choose";
      reason: string;
    };

type AutomaticDirectoryInput = {
  workspaceRoots: readonly string[];
  worktrees: readonly GitWorktree[];
  activeWriterCwds: readonly string[];
  kind: SessionKind;
  canonicalDzialki: boolean;
  gitRepository?: boolean;
  launcherExists: (cwd: string) => boolean;
};

export function planAutomaticDirectory(
  input: AutomaticDirectoryInput,
): AutomaticDirectoryPlan {
  const root = input.workspaceRoots[0];
  if (!root) {
    return {
      action: "choose",
      reason: "No workspace folder is open.",
    };
  }

  const current =
    input.worktrees.find((worktree) =>
      sameDirectory(worktree.path, root),
    ) ??
    ({
      path: root,
      bare: false,
      detached: false,
      prunable: false,
    } satisfies GitWorktree);

  if (input.gitRepository === false) {
    return {
      action: "use",
      directory: toDirectory(current),
    };
  }

  if (!input.canonicalDzialki) {
    return input.kind === "work"
      ? { action: "create", role: "work" }
      : { action: "use", directory: toDirectory(current) };
  }

  const eligible = input.worktrees.filter(
    (worktree) =>
      !worktree.bare &&
      !worktree.detached &&
      !worktree.prunable &&
      worktree.branch?.startsWith("wip/") === true &&
      input.launcherExists(worktree.path),
  );
  const hasWriter = (cwd: string): boolean =>
    input.activeWriterCwds.some((active) =>
      sameDirectory(active, cwd),
    );

  if (input.kind === "loop") {
    return { action: "create", role: "loop" };
  }

  if (input.kind === "work") {
    return { action: "create", role: "work" };
  }

  const currentEligible = eligible.find((worktree) =>
    sameDirectory(worktree.path, current.path),
  );
  if (
    currentEligible &&
    (input.kind === "readonly" || !hasWriter(currentEligible.path))
  ) {
    return {
      action: "use",
      directory: toDirectory(currentEligible),
    };
  }

  if (input.kind === "readonly") {
    const active = eligible.find((worktree) =>
      input.activeWriterCwds.some((cwd) =>
        sameDirectory(cwd, worktree.path),
      ),
    );
    if (active) {
      return {
        action: "use",
        directory: toDirectory(active),
      };
    }
  }

  const daily = eligible.find(
    (worktree) =>
      isDedicatedBranch(worktree.branch, "omp-daily-driver") &&
      !hasWriter(worktree.path),
  );
  if (daily) {
    return {
      action: "use",
      directory: toDirectory(daily),
    };
  }

  return {
    action: "choose",
    reason: "No trusted Dzialkopedia OMP worktree is available.",
  };
}

export function provisionManagementRoot(input: {
  currentRepositoryRoot?: string;
  worktrees: readonly GitWorktree[];
  canonicalDzialki: boolean;
}): string | undefined {
  if (!input.canonicalDzialki) return input.currentRepositoryRoot;
  return (
    input.worktrees.find((worktree) => worktree.branch === "main")?.path ??
    input.currentRepositoryRoot
  );
}

function toDirectory(worktree: GitWorktree): SessionDirectory {
  return {
    cwd: worktree.path,
    ...(worktree.branch ? { branch: worktree.branch } : {}),
  };
}

function isDedicatedBranch(
  branch: string | undefined,
  role: string,
): boolean {
  return branch?.includes(`-${role}`) === true;
}
