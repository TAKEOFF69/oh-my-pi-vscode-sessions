import * as crypto from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import * as os from "node:os";
import * as nodePath from "node:path";

import { repositoryIdentity } from "./worktrees";

export type WriterLeaseOwner = {
  token: string;
  pid: number;
  cwd: string;
  label: string;
  acquiredAt: string;
};

export type WriterLease = {
  owner: WriterLeaseOwner;
  release(): Promise<void>;
};

export type LeaseAttempt =
  | { acquired: true; lease: WriterLease }
  | { acquired: false; owner?: WriterLeaseOwner };

type WriterLeaseTestHooks = {
  afterPublish?: () => Promise<void> | void;
};

type LeaseRecord =
  | {
      path: string;
      owner: WriterLeaseOwner;
      legacy: boolean;
      state: "valid";
    }
  | {
      path: string;
      legacy: boolean;
      state: "ambiguous";
    };

type OwnerRead =
  | { state: "valid"; owner: WriterLeaseOwner }
  | { state: "missing" }
  | { state: "ambiguous" };

export async function acquireWriterLease(
  cwd: string,
  label: string,
): Promise<LeaseAttempt> {
  const { canonicalCwd, leaseRoot } = await leaseCoordinates(cwd);
  return acquireWriterLeaseAtRoot(canonicalCwd, label, leaseRoot);
}

export async function inspectActiveWriterLease(
  cwd: string,
): Promise<WriterLeaseOwner | undefined> {
  const { canonicalCwd, leaseRoot } = await leaseCoordinates(cwd);
  const records = await readLeaseRecords(canonicalCwd, leaseRoot);
  if (records.some((record) => record.state === "ambiguous")) {
    throw new Error("Writer lease state is unreadable; refusing unsafe inspection");
  }
  return records
    .filter((record) => record.state === "valid")
    .map((record) => record.owner)
    .find((owner) => isProcessAlive(owner.pid));
}

export async function acquireWriterLeaseAtRoot(
  canonicalCwd: string,
  label: string,
  leaseRoot: string,
  testHooks: WriterLeaseTestHooks = {},
): Promise<LeaseAttempt> {
  await mkdir(leaseRoot, { recursive: true });
  const owner: WriterLeaseOwner = {
    token: crypto.randomUUID(),
    pid: process.pid,
    cwd: canonicalCwd,
    label,
    acquiredAt: new Date().toISOString(),
  };
  const ownPath = tokenLeasePath(canonicalCwd, leaseRoot, owner.token);
  if (!(await publishOwnerAtomically(ownPath, owner))) {
    return { acquired: false };
  }

  try {
    await testHooks.afterPublish?.();
    const records = await readLeaseRecords(canonicalCwd, leaseRoot);
    let conflict: WriterLeaseOwner | undefined;
    let blocked = false;
    let ownTokenVerified = false;
    for (const record of records) {
      if (record.path === ownPath) {
        ownTokenVerified =
          record.state === "valid" && record.owner.token === owner.token;
        blocked ||= !ownTokenVerified;
        continue;
      }
      if (record.state === "ambiguous") {
        blocked = true;
        continue;
      }
      if (isProcessAlive(record.owner.pid)) {
        blocked = true;
        conflict ??= record.owner;
        continue;
      }
      if (record.legacy) {
        // Version 2.6 used one mutable lease path. It cannot be reclaimed
        // automatically without recreating the compare-then-unlink race.
        blocked = true;
        conflict ??= record.owner;
        continue;
      }
      await unlinkExact(record.path);
    }

    blocked ||= !ownTokenVerified;

    if (blocked) {
      await unlinkExact(ownPath);
      return { acquired: false, owner: conflict };
    }
    return {
      acquired: true,
      lease: {
        owner,
        release: () => releaseLease(ownPath, owner.token),
      },
    };
  } catch (error) {
    await unlinkExact(ownPath);
    throw error;
  }
}

async function releaseLease(leasePath: string, token: string): Promise<void> {
  const current = await readOwner(leasePath);
  if (!current || current.token !== token) return;
  await unlinkExact(leasePath);
}

async function publishOwnerAtomically(
  leasePath: string,
  owner: WriterLeaseOwner,
): Promise<boolean> {
  const candidatePath = `${leasePath}.candidate`;
  try {
    const handle = await open(
      candidatePath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    try {
      await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(candidatePath, leasePath);
    return true;
  } catch {
    return false;
  } finally {
    await unlinkExact(candidatePath);
  }
}

async function readLeaseRecords(
  canonicalCwd: string,
  leaseRoot: string,
): Promise<LeaseRecord[]> {
  const key = leaseKey(canonicalCwd);
  const legacyName = `${key}.json`;
  const tokenPrefix = `${key}.`;
  let names: string[];
  try {
    names = await readdir(leaseRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records: LeaseRecord[] = [];
  for (const name of names) {
    const legacy = name === legacyName;
    const tokenLease =
      name.startsWith(tokenPrefix) &&
      name.endsWith(".json") &&
      !name.endsWith(".candidate");
    if (!legacy && !tokenLease) continue;
    const path = nodePath.join(leaseRoot, name);
    const ownerRead = await readOwnerState(path);
    if (ownerRead.state === "missing") continue;
    if (
      !legacy &&
      (ownerRead.state !== "valid" ||
        ownerRead.owner.token !==
          name.slice(tokenPrefix.length, -".json".length))
    ) {
      records.push({ path, legacy, state: "ambiguous" });
      continue;
    }
    if (ownerRead.state === "ambiguous") {
      records.push({ path, legacy, state: "ambiguous" });
      continue;
    }
    records.push({
      path,
      legacy,
      state: "valid",
      owner: ownerRead.owner,
    });
  }
  return records;
}

async function readOwner(
  leasePath: string,
): Promise<WriterLeaseOwner | undefined> {
  const result = await readOwnerState(leasePath);
  return result.state === "valid" ? result.owner : undefined;
}

async function readOwnerState(leasePath: string): Promise<OwnerRead> {
  try {
    const parsed = JSON.parse(await readFile(leasePath, "utf8"));
    return typeof parsed?.token === "string" &&
      Number.isInteger(parsed?.pid) &&
      typeof parsed?.cwd === "string" &&
      typeof parsed?.label === "string" &&
      typeof parsed?.acquiredAt === "string"
      ? { state: "valid", owner: parsed }
      : { state: "ambiguous" };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { state: "missing" }
      : { state: "ambiguous" };
  }
}

async function unlinkExact(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Unique token paths are never reused; absent already means released.
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function normalizeIdentity(value: string): string {
  const normalized = nodePath.resolve(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function leaseCoordinates(cwd: string): Promise<{
  canonicalCwd: string;
  leaseRoot: string;
}> {
  const repository = await repositoryIdentity(cwd);
  return {
    canonicalCwd: await realpath(repository?.root ?? cwd),
    leaseRoot: repository
      ? nodePath.join(
          await realpath(repository.commonDir),
          "omp-vscode-session-leases",
        )
      : nodePath.join(os.tmpdir(), "omp-vscode-session-leases"),
  };
}

function tokenLeasePath(
  canonicalCwd: string,
  leaseRoot: string,
  token: string,
): string {
  return nodePath.join(leaseRoot, `${leaseKey(canonicalCwd)}.${token}.json`);
}

function leaseKey(canonicalCwd: string): string {
  return crypto
    .createHash("sha256")
    .update(normalizeIdentity(canonicalCwd))
    .digest("hex");
}
