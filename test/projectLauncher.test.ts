import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";
import { test } from "node:test";

import {
  CANONICAL_ADAPTER_PATHS,
  canonicalDzialkiOrigin,
  createCanonicalSnapshotLoader,
  detectProjectLauncher,
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
  const code = nodePath.resolve(
    "C:/Users/test/AppData/Local/Programs/Microsoft VS Code/Code.exe",
  );
  const node = nodePath.resolve("C:/Program Files/nodejs/node.exe");
  assert.equal(
    resolveNodeExecutable({
      execPath: code,
      pathValue: nodePath.dirname(node),
      pathExists: (candidate) => candidate === node,
      platform: "win32",
    }),
    node,
  );
});

test("project launcher fails closed when real Node cannot be found", () => {
  assert.throws(
    () =>
      resolveNodeExecutable({
        execPath: nodePath.resolve("C:/Program Files/Editor/Code.exe"),
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
      nodePath.join(root, "scripts", "omp", "runtime-tools.mjs"),
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
});
