import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import { test } from "node:test";

import {
  CANONICAL_ADAPTER_PATHS,
  CANONICAL_DZIALKI_NODE_ID,
  canonicalDzialkiOrigin,
  createCanonicalSnapshotLoader,
  detectProjectLauncher,
  fetchCanonicalGitHubSnapshot,
  gitBlobSha,
  parseCanonicalAdapterPaths,
  resolveNodeExecutable,
  validateCanonicalDzialkiAdapter,
} from "../src/projectLauncher";

test("trusted selected worktree launcher outranks lobby workspace settings", async () => {
  const cwd = nodePath.resolve("C:/repo-worktree");
  const expected = nodePath.join(cwd, "scripts", "omp", "launch.mjs");
  assert.deepEqual(
    await detectProjectLauncher(cwd, {
      pathExists: (candidate) => candidate === expected,
      identifyRepository: async () => ({
        root: cwd,
        commonDir: nodePath.join(cwd, ".git"),
        origin: "git@github.com:TAKEOFF69/dzialki.git",
      }),
      launcherMatchesCanonical: async () => true,
      resolveNodeExecutable: () =>
        nodePath.resolve("C:/Program Files/nodejs/node.exe"),
    }),
    {
      executable: nodePath.resolve(
        "C:/Program Files/nodejs/node.exe",
      ),
      baseArgs: [expected],
      readOnlyArgument: "--read-only",
      rpcArgument: "--rpc",
      parityKind: "dzialki-v1",
    },
  );
  await assert.rejects(
    () =>
      detectProjectLauncher(cwd, {
        pathExists: () => false,
        identifyRepository: async () => ({
          root: cwd,
          commonDir: nodePath.join(cwd, ".git"),
          origin: "https://github.com/TAKEOFF69/dzialki",
        }),
        launcherMatchesCanonical: async () => false,
      }),
    /no canonical launcher.*wip\/\*/,
  );
});

test("project launcher resolves Node from PATH when extension host is Code.exe", () => {
  const code = nodePath.win32.resolve(
    "C:/Users/test/AppData/Local/Programs/Microsoft VS Code/Code.exe",
  );
  const node = nodePath.win32.resolve("C:/Program Files/nodejs/node.exe");
  assert.equal(
    resolveNodeExecutable({
      execPath: code,
      pathValue: nodePath.win32.dirname(node),
      pathExists: (candidate) => candidate === node,
      platform: "win32",
    }),
    node,
  );
});

test("project launcher resolves Node from a POSIX PATH", () => {
  const node = "/opt/node/bin/node";
  assert.equal(
    resolveNodeExecutable({
      execPath: "/usr/share/code/code",
      pathValue: "/opt/node/bin:/usr/bin",
      pathExists: (candidate) => candidate === node,
      platform: "linux",
    }),
    node,
  );
});

test("project launcher fails closed when real Node cannot be found", () => {
  assert.throws(
    () =>
      resolveNodeExecutable({
        execPath: nodePath.win32.resolve("C:/Program Files/Editor/Code.exe"),
        pathValue: "",
        pathExists: () => false,
        platform: "win32",
      }),
    /Node\.js executable.*not found/i,
  );
});

test("canonical snapshot loader shares warmup and honors its TTL", async () => {
  let now = 10_000;
  let loads = 0;
  const expected = {
    blobShas: new Map([["scripts/omp/launch.mjs", "abc123"]]),
    declaredPaths: ["scripts/omp/launch.mjs"],
  };
  const load = createCanonicalSnapshotLoader(
    async () => {
      loads += 1;
      return expected;
    },
    5_000,
    () => now,
  );

  assert.deepEqual(await Promise.all([load(), load()]), [
    expected,
    expected,
  ]);
  assert.equal(loads, 1);
  now += 4_999;
  assert.equal(await load(), expected);
  assert.equal(loads, 1);
  now += 2;
  assert.equal(await load(), expected);
  assert.equal(loads, 2);
});

test("canonical GitHub snapshot accepts renamed alias only for stable repository identity", async () => {
  const calls: string[] = [];
  const preflight = `export const ADAPTER_PATHS = Object.freeze(${JSON.stringify(
    CANONICAL_ADAPTER_PATHS,
  )});`;
  const tree = CANONICAL_ADAPTER_PATHS.map((path, index) => ({
    type: "blob",
    path,
    sha: index === 0 ? "0".repeat(40) : `${index}`.padStart(40, "0"),
  }));
  const preflightEntry = tree.find(
    (entry) => entry.path === "scripts/omp/preflight.mjs",
  );
  assert.ok(preflightEntry);
  const snapshot = await fetchCanonicalGitHubSnapshot(async (endpoint) => {
    calls.push(endpoint);
    if (endpoint === "repos/mateusz-stawczyk/dzialki") {
      return { node_id: CANONICAL_DZIALKI_NODE_ID };
    }
    if (endpoint.endsWith("/git/trees/main?recursive=1")) {
      return { truncated: false, tree };
    }
    if (endpoint.endsWith(`/git/blobs/${preflightEntry.sha}`)) {
      return {
        encoding: "base64",
        content: Buffer.from(preflight, "utf8").toString("base64"),
      };
    }
    throw new Error(`unexpected endpoint: ${endpoint}`);
  });
  assert.deepEqual(snapshot.declaredPaths, CANONICAL_ADAPTER_PATHS);
  assert.equal(calls[0], "repos/mateusz-stawczyk/dzialki");
  assert.ok(calls.every((endpoint) => !endpoint.includes("attacker")));
});

test("canonical GitHub snapshot rejects a lookalike future namespace and falls back to current alias", async () => {
  const calls: string[] = [];
  const preflight = `export const ADAPTER_PATHS = Object.freeze(${JSON.stringify(
    CANONICAL_ADAPTER_PATHS,
  )});`;
  const tree = CANONICAL_ADAPTER_PATHS.map((path, index) => ({
    type: "blob",
    path,
    sha: `${index + 1}`.padStart(40, "0"),
  }));
  const preflightSha = tree.find(
    (entry) => entry.path === "scripts/omp/preflight.mjs",
  )?.sha;
  assert.ok(preflightSha);
  await fetchCanonicalGitHubSnapshot(async (endpoint) => {
    calls.push(endpoint);
    if (endpoint === "repos/mateusz-stawczyk/dzialki") {
      return { node_id: "R_attacker" };
    }
    if (endpoint === "repos/TAKEOFF69/dzialki") {
      return { node_id: CANONICAL_DZIALKI_NODE_ID };
    }
    if (endpoint.endsWith("/git/trees/main?recursive=1")) {
      return { truncated: false, tree };
    }
    if (endpoint.endsWith(`/git/blobs/${preflightSha}`)) {
      return {
        encoding: "base64",
        content: Buffer.from(preflight, "utf8").toString("base64"),
      };
    }
    throw new Error(`unexpected endpoint: ${endpoint}`);
  });
  assert.deepEqual(calls.slice(0, 2), [
    "repos/mateusz-stawczyk/dzialki",
    "repos/TAKEOFF69/dzialki",
  ]);
});

test("canonical snapshot loader never caches a failed lookup", async () => {
  let loads = 0;
  const expected = {
    blobShas: new Map<string, string>(),
    declaredPaths: [] as string[],
  };
  const load = createCanonicalSnapshotLoader(
    async () => {
      loads += 1;
      if (loads === 1) {
        throw new Error("offline");
      }
      return expected;
    },
    5_000,
  );

  await assert.rejects(load, /offline/);
  assert.equal(await load(), expected);
  assert.equal(loads, 2);
});

test("canonical remote with modified launcher fails closed", async () => {
  const cwd = nodePath.resolve("C:/modified-dzialki");
  await assert.rejects(
    () =>
      detectProjectLauncher(cwd, {
        pathExists: () => true,
        identifyRepository: async () => ({
          root: cwd,
          commonDir: nodePath.join(cwd, ".git"),
          origin: "https://github.com/TAKEOFF69/dzialki.git",
        }),
        launcherMatchesCanonical: async () => false,
      }),
    /canonical GitHub main/,
  );
});

test("canonical validation binds every executable adapter byte to GitHub main", async () => {
  const root = await mkdtemp(
    nodePath.join(os.tmpdir(), "omp-launcher-provenance-"),
  );
  const contents = new Map(
    CANONICAL_ADAPTER_PATHS.map((relativePath) => [
      relativePath,
      `canonical:${relativePath}\n`,
    ]),
  );
  const canonical = new Map(
    [...contents].map(([relativePath, value]) => [
      relativePath,
      gitBlobSha(value),
    ]),
  );
  try {
    for (const [relativePath, value] of contents) {
      const localPath = nodePath.join(root, relativePath);
      await mkdir(nodePath.dirname(localPath), { recursive: true });
      await writeFile(localPath, value, "utf8");
    }
    const loader = async () => ({
      blobShas: canonical,
      declaredPaths: CANONICAL_ADAPTER_PATHS,
    });

    assert.equal(await validateCanonicalDzialkiAdapter(root, loader), true);
    await writeFile(
      nodePath.join(root, "docs", "loop", "bin", "redact-log.py"),
      "modified\n",
      "utf8",
    );
    assert.equal(await validateCanonicalDzialkiAdapter(root, loader), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical snapshot must cover full pinned adapter inventory", async () => {
  const root = await mkdtemp(
    nodePath.join(os.tmpdir(), "omp-launcher-inventory-"),
  );
  try {
    assert.equal(
      await validateCanonicalDzialkiAdapter(root, async () => ({
        blobShas: new Map(),
        declaredPaths: CANONICAL_ADAPTER_PATHS,
      })),
      false,
    );
    assert.ok(
      CANONICAL_ADAPTER_PATHS.includes(
        ".claude/skills/loop-creator/scripts/loopctl.py",
      ),
    );
    assert.ok(
      CANONICAL_ADAPTER_PATHS.includes(
        ".claude/skills/loop-creator/scripts/loop_preflight.mjs",
      ),
    );
    assert.ok(
      CANONICAL_ADAPTER_PATHS.includes(
        ".claude/skills/loop-creator/references/preflight-config.md",
      ),
    );
    assert.ok(CANONICAL_ADAPTER_PATHS.includes("package.json"));
    assert.ok(CANONICAL_ADAPTER_PATHS.includes("package-lock.json"));
    assert.ok(CANONICAL_ADAPTER_PATHS.includes(".githooks/commit-msg"));
    assert.ok(CANONICAL_ADAPTER_PATHS.includes(".githooks/pre-commit"));
    assert.ok(CANONICAL_ADAPTER_PATHS.includes(".githooks/pre-push"));
    assert.ok(
      CANONICAL_ADAPTER_PATHS.includes("scripts/agent/cleanup-worktree.mjs"),
    );
    assert.ok(
      CANONICAL_ADAPTER_PATHS.includes("scripts/agent/start-worktree.mjs"),
    );
    assert.ok(CANONICAL_ADAPTER_PATHS.includes("docs/loop/bin/redact-log.py"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical declaration cannot add an unpinned adapter dependency", async () => {
  const root = await mkdtemp(
    nodePath.join(os.tmpdir(), "omp-launcher-extra-path-"),
  );
  try {
    assert.equal(
      await validateCanonicalDzialkiAdapter(root, async () => ({
        blobShas: new Map([
          ...CANONICAL_ADAPTER_PATHS.map(
            (path) => [path, gitBlobSha("")] as const,
          ),
          ["scripts/omp/new-executable.mjs", gitBlobSha("")],
        ]),
        declaredPaths: [
          ...CANONICAL_ADAPTER_PATHS,
          "scripts/omp/new-executable.mjs",
        ],
      })),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical inventory parser rejects traversal and duplicates", () => {
  assert.throws(
    () =>
      parseCanonicalAdapterPaths(
        'export const ADAPTER_PATHS = Object.freeze(["../escape"]);',
      ),
    /malformed/,
  );
  assert.throws(
    () =>
      parseCanonicalAdapterPaths(
        'export const ADAPTER_PATHS = Object.freeze(["same", "same"]);',
      ),
    /duplicates/,
  );
});

test("arbitrary lookalike launcher is never executed", async () => {
  const cwd = nodePath.resolve("C:/lookalike");
  assert.equal(
    await detectProjectLauncher(cwd, {
      pathExists: () => true,
      identifyRepository: async () => ({
        root: cwd,
        commonDir: nodePath.join(cwd, ".git"),
        origin: "https://github.com/attacker/dzialki",
      }),
    }),
    undefined,
  );
  assert.equal(canonicalDzialkiOrigin("https://github.com/attacker/dzialki"), false);
  assert.equal(canonicalDzialkiOrigin("https://github.com/TAKEOFF69/dzialki.git"), true);
  assert.equal(
    canonicalDzialkiOrigin("https://github.com/mateusz-stawczyk/dzialki.git"),
    true,
  );
  assert.equal(
    canonicalDzialkiOrigin("https://github.com/mateusz-stawczyk/dzialki-fork.git"),
    false,
  );
});
