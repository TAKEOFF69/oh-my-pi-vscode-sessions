import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as nodePath from "node:path";
import { promisify } from "node:util";

import {
  repositoryIdentity,
  type GitRepositoryIdentity,
} from "./worktrees";

export type ProjectLauncher = {
  executable: string;
  baseArgs: readonly string[];
  readOnlyArgument: string;
  rpcArgument: string;
  parityKind?: "dzialki-v1";
};

type ProjectLauncherDetectionOptions = {
  pathExists?: (candidate: string) => boolean;
  resolveNodeExecutable?: () => string;
  identifyRepository?: (
    cwd: string,
  ) => Promise<GitRepositoryIdentity | undefined>;
  launcherMatchesCanonical?: (
    identity: GitRepositoryIdentity,
    launcher: string,
  ) => Promise<boolean>;
};

const execFileAsync = promisify(execFile);
const CANONICAL_TREE_ENDPOINT =
  "repos/TAKEOFF69/dzialki/git/trees/main?recursive=1";
export const CANONICAL_ADAPTER_PATHS = [
  ".claude/hooks/block-loop-questions.js",
  ".claude/hooks/evals/block-loop-questions.json",
  ".claude/settings.json",
  ".claude/skills/loop-auditor/SKILL.md",
  ".claude/skills/loop-auditor/scripts/loop_auditor.py",
  ".claude/skills/loop-creator/SKILL.md",
  ".claude/skills/loop-creator/references/manifest-contract.md",
  ".claude/skills/loop-creator/references/preflight-config.md",
  ".claude/skills/loop-creator/references/runtime-semantics.md",
  ".claude/skills/loop-creator/scripts/leader_lease.py",
  ".claude/skills/loop-creator/scripts/loop_harness.py",
  ".claude/skills/loop-creator/scripts/loop_preflight.mjs",
  ".claude/skills/loop-creator/scripts/loopctl.py",
  ".claude/skills/loop-start/SKILL.md",
  ".omp/config.yml",
  ".omp/config-safe.yml",
  ".omp/AGENTS.md",
  ".omp/RULES.md",
  ".omp/WATCHDOG.md",
  ".omp/commands/loop-start.md",
  ".omp/commands/omp-doctor.md",
  ".omp/extensions/project-policy.ts",
  ".omp/skills/loop-start/SKILL.md",
  "package.json",
  "package-lock.json",
  ".githooks/commit-msg",
  ".githooks/pre-commit",
  ".githooks/pre-push",
  "scripts/agent/cleanup-worktree.mjs",
  "scripts/agent/start-worktree.mjs",
  "scripts/build-agent-index.mjs",
  "scripts/check-prompt-briefs.mjs",
  "scripts/git/audyt-ledger-guard.mjs",
  "scripts/git/cleanup-manifest-guard.mjs",
  "scripts/git/commit-guard.sh",
  "scripts/git/diff-scope-guard.mjs",
  "scripts/git/docs-only-classifier.mjs",
  "scripts/git/guard-utils.mjs",
  "scripts/git/ignored-staged-guard.sh",
  "scripts/git/main-pre-push-guard.mjs",
  "scripts/git/state-guard.mjs",
  "scripts/git/ui-verification-reminder.mjs",
  "scripts/git/worktree-utils.mjs",
  "docs/loop/bin/check-dispatch.py",
  "docs/loop/bin/codex-run.sh",
  "docs/loop/bin/redact-log.py",
  "scripts/omp/launch.mjs",
  "scripts/omp/policy.mjs",
  "scripts/omp/preflight.mjs",
  "scripts/omp/runtime-tools.mjs",
  "scripts/omp/windows-job-runner.ps1",
] as const;
const PREFLIGHT_PATH = "scripts/omp/preflight.mjs";

export type CanonicalAdapterSnapshot = {
  blobShas: ReadonlyMap<string, string>;
  declaredPaths: readonly string[];
};

type NodeExecutableResolutionOptions = {
  execPath?: string;
  pathValue?: string;
  pathExists?: (candidate: string) => boolean;
  platform?: NodeJS.Platform;
};

export async function detectProjectLauncher(
  cwd: string,
  options: ProjectLauncherDetectionOptions = {},
): Promise<ProjectLauncher | undefined> {
  const identity = await (
    options.identifyRepository ?? repositoryIdentity
  )(cwd);
  if (!identity || !canonicalDzialkiOrigin(identity.origin)) {
    return undefined;
  }
  const launcher = nodePath.join(
    identity.root,
    "scripts",
    "omp",
    "launch.mjs",
  );
  if (!(options.pathExists ?? existsSync)(launcher)) {
    throw new Error(
      "Selected Dzialkopedia checkout has no canonical launcher. Shared or stale main is unsupported; choose a current wip/* worktree created from origin/main.",
    );
  }
  const matches = await (
    options.launcherMatchesCanonical ?? launcherMatchesCanonicalMain
  )(identity, launcher);
  if (!matches) {
    throw new Error(
      "Dzialkopedia adapter does not match canonical GitHub main; refusing execution",
    );
  }
  return {
    executable: (
      options.resolveNodeExecutable ?? resolveNodeExecutable
    )(),
    baseArgs: [launcher],
    readOnlyArgument: "--read-only",
    rpcArgument: "--rpc",
    parityKind: "dzialki-v1",
  };
}

export function resolveNodeExecutable(
  options: NodeExecutableResolutionOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const pathExists = options.pathExists ?? existsSync;
  const execPath = options.execPath ?? process.execPath;
  const pathApi =
    platform === "win32" ? nodePath.win32 : nodePath.posix;
  const nodeName = platform === "win32" ? "node.exe" : "node";

  if (
    pathApi.basename(execPath).toLowerCase() ===
      nodeName.toLowerCase() &&
    pathExists(execPath)
  ) {
    return execPath;
  }

  const delimiter = platform === "win32" ? ";" : ":";
  const pathValue = options.pathValue ?? process.env.PATH ?? "";
  for (const rawEntry of pathValue.split(delimiter)) {
    const entry = rawEntry.trim().replace(/^"(.*)"$/, "$1");
    if (!entry) {
      continue;
    }
    const candidate = pathApi.join(entry, nodeName);
    if (pathExists(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Node.js executable was not found. Install Node.js or add node to PATH before starting a Dzialkopedia OMP session.",
  );
}

export function canonicalDzialkiOrigin(origin: string | undefined): boolean {
  if (!origin) {
    return false;
  }
  const normalized = origin
    .trim()
    .replace(/^git@github\.com:/i, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//i, "https://github.com/")
    .replace(/^https?:\/\/[^@/]+@github\.com\//i, "https://github.com/")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  return normalized === "https://github.com/takeoff69/dzialki";
}

export async function validateCanonicalDzialkiAdapter(
  root: string,
  loadCanonicalSnapshot: () => Promise<CanonicalAdapterSnapshot> =
    loadCanonicalGitHubSnapshot,
): Promise<boolean> {
  try {
    const canonical = await loadCanonicalSnapshot();
    if (
      !sameAdapterInventory(
        canonical.declaredPaths,
        CANONICAL_ADAPTER_PATHS,
      ) ||
      CANONICAL_ADAPTER_PATHS.some(
        (path) => !canonical.blobShas.has(path),
      )
    ) {
      return false;
    }
    const matches = await Promise.all(
      CANONICAL_ADAPTER_PATHS.map(async (relativePath) => {
        const localPath = containedAdapterPath(root, relativePath);
        if (!localPath) {
          return false;
        }
        const local = await readFile(localPath, "utf8");
        return (
          gitBlobSha(normalizeText(local)) ===
          canonical.blobShas.get(relativePath)
        );
      }),
    );
    return matches.every(Boolean);
  } catch {
    return false;
  }
}

export function parseCanonicalAdapterPaths(source: string): string[] {
  const match = source.match(
    /export\s+const\s+ADAPTER_PATHS\s*=\s*Object\.freeze\(\s*(\[[\s\S]*?\])\s*\);/,
  );
  if (!match) {
    throw new Error("Canonical preflight has no ADAPTER_PATHS inventory");
  }
  const paths = [...match[1].matchAll(/"(?:\\.|[^"\\])*"/g)].map(
    (entry) => JSON.parse(entry[0]) as unknown,
  );
  if (
    paths.length === 0 ||
    paths.some(
      (value) =>
        typeof value !== "string" ||
        !value ||
        nodePath.isAbsolute(value) ||
        value.includes("\\") ||
        value.split("/").includes(".."),
    )
  ) {
    throw new Error("Canonical ADAPTER_PATHS inventory is malformed");
  }
  const unique = new Set(paths as string[]);
  if (unique.size !== paths.length) {
    throw new Error("Canonical ADAPTER_PATHS inventory has duplicates");
  }
  return [...unique];
}

export function gitBlobSha(contents: string): string {
  const bytes = Buffer.from(contents, "utf8");
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

async function launcherMatchesCanonicalMain(
  identity: GitRepositoryIdentity,
  _launcher: string,
): Promise<boolean> {
  return validateCanonicalDzialkiAdapter(identity.root);
}

function containedAdapterPath(
  root: string,
  relativePath: string,
): string | undefined {
  const resolvedRoot = nodePath.resolve(root);
  const resolved = nodePath.resolve(resolvedRoot, relativePath);
  const relative = nodePath.relative(resolvedRoot, resolved);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${nodePath.sep}`) ||
    nodePath.isAbsolute(relative)
  ) {
    return undefined;
  }
  return resolved;
}

async function fetchCanonicalGitHubSnapshot(): Promise<
  CanonicalAdapterSnapshot
> {
  const payload = (await loadGitHubJson(CANONICAL_TREE_ENDPOINT)) as {
    truncated?: unknown;
    tree?: unknown;
  };
  if (payload.truncated !== false || !Array.isArray(payload.tree)) {
    throw new Error("Canonical GitHub tree is missing or truncated");
  }
  const snapshot = new Map<string, string>();
  const wanted = new Set<string>(CANONICAL_ADAPTER_PATHS);
  for (const entry of payload.tree) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      (entry as { type?: unknown }).type === "blob" &&
      typeof (entry as { path?: unknown }).path === "string" &&
      typeof (entry as { sha?: unknown }).sha === "string" &&
      wanted.has((entry as { path: string }).path)
    ) {
      snapshot.set(
        (entry as { path: string }).path,
        (entry as { sha: string }).sha,
      );
    }
  }
  const preflightSha = snapshot.get(PREFLIGHT_PATH);
  if (!preflightSha) {
    throw new Error("Canonical GitHub tree has no OMP preflight blob");
  }
  const blob = (await loadGitHubJson(
    `repos/TAKEOFF69/dzialki/git/blobs/${preflightSha}`,
  )) as {
    content?: unknown;
    encoding?: unknown;
  };
  if (
    blob.encoding !== "base64" ||
    typeof blob.content !== "string"
  ) {
    throw new Error("Canonical preflight blob is not base64");
  }
  const preflight = Buffer.from(
    blob.content.replace(/\s/g, ""),
    "base64",
  );
  if (preflight.byteLength > 2 * 1024 * 1024) {
    throw new Error("Canonical preflight blob exceeds 2 MiB");
  }
  return {
    blobShas: snapshot,
    declaredPaths: parseCanonicalAdapterPaths(
      preflight.toString("utf8"),
    ),
  };
}

export function createCanonicalSnapshotLoader(
  load: () => Promise<CanonicalAdapterSnapshot>,
  ttlMs: number,
  now: () => number = Date.now,
): () => Promise<CanonicalAdapterSnapshot> {
  let cached:
    | {
        expiresAt: number;
        promise: Promise<CanonicalAdapterSnapshot>;
      }
    | undefined;
  return () => {
    const current = now();
    if (cached && current < cached.expiresAt) {
      return cached.promise;
    }
    const promise = load();
    const next = {
      expiresAt: current + ttlMs,
      promise,
    };
    cached = next;
    void promise.catch(() => {
      if (cached === next) {
        cached = undefined;
      }
    });
    return promise;
  };
}

const loadCanonicalGitHubSnapshot = createCanonicalSnapshotLoader(
  fetchCanonicalGitHubSnapshot,
  5 * 60_000,
);

export function warmCanonicalDzialkiAdapterSnapshot(): void {
  void loadCanonicalGitHubSnapshot().catch(() => undefined);
}

async function loadGitHubJson(endpoint: string): Promise<unknown> {
  const { stdout } = await execFileAsync(
    "gh",
    ["api", "--hostname", "github.com", endpoint],
    {
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    },
  );
  return JSON.parse(stdout);
}

function normalizeText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function sameAdapterInventory(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  if (actual.length !== expected.length) {
    return false;
  }
  const actualSet = new Set(actual);
  return expected.every((path) => actualSet.has(path));
}
