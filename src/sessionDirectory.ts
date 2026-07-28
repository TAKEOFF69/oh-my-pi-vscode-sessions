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
      action: "choose";
      reason: string;
    };

type AutomaticDirectoryInput = {
  workspaceRoots: readonly string[];
  worktrees: readonly GitWorktree[];
  activeWriterCwds: readonly string[];
  kind: SessionKind;
  canonicalDzialki: boolean;
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

  if (!input.canonicalDzialki) {
    return {
      action: "use",
      directory: toDirectory(current),
    };
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
    const controller = eligible.find(
      (worktree) =>
        isDedicatedBranch(worktree.branch, "omp-loop-controller") &&
        !hasWriter(worktree.path),
    );
    return controller
      ? { action: "use", directory: toDirectory(controller) }
      : {
          action: "choose",
          reason:
            "No available dedicated Loop controller worktree was found.",
        };
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
      (input.kind === "readonly" || !hasWriter(worktree.path)),
  );
  if (daily) {
    return {
      action: "use",
      directory: toDirectory(daily),
    };
  }

  return {
    action: "choose",
    reason:
      input.kind === "readonly"
        ? "No trusted Dzialkopedia OMP worktree is available."
        : "No writer-safe Dzialkopedia OMP worktree is available.",
  };
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
