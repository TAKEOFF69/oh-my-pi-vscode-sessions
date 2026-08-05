import * as crypto from "node:crypto";
import { constants } from "node:fs";
import {
  mkdir,
  open,
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
  const owner = await readOwner(leasePathFor(canonicalCwd, leaseRoot));
  return owner && isProcessAlive(owner.pid) ? owner : undefined;
}

export async function acquireWriterLeaseAtRoot(
  canonicalCwd: string,
  label: string,
  leaseRoot: string,
): Promise<LeaseAttempt> {
  await mkdir(leaseRoot, { recursive: true });
  const leasePath = leasePathFor(canonicalCwd, leaseRoot);
  const owner: WriterLeaseOwner = {
    token: crypto.randomUUID(),
    pid: process.pid,
    cwd: canonicalCwd,
    label,
    acquiredAt: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(
        leasePath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      try {
        await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
      } finally {
        await handle.close();
      }
      return {
        acquired: true,
        lease: {
          owner,
          release: () => releaseLease(leasePath, owner.token),
        },
      };
    } catch (error) {
      if (!isAlreadyExists(error)) {
        return { acquired: false };
      }
      const existing = await readOwner(leasePath);
      if (existing && isProcessAlive(existing.pid)) {
        return { acquired: false, owner: existing };
      }
      try {
        await unlink(leasePath);
      } catch {
        return { acquired: false, owner: existing };
      }
    }
  }
  return { acquired: false };
}

async function releaseLease(leasePath: string, token: string): Promise<void> {
  const current = await readOwner(leasePath);
  if (!current || current.token !== token) {
    return;
  }
  try {
    await unlink(leasePath);
  } catch {
    // Lease is already gone or raced with stale-owner recovery.
  }
}

async function readOwner(
  leasePath: string,
): Promise<WriterLeaseOwner | undefined> {
  try {
    const parsed = JSON.parse(await readFile(leasePath, "utf8"));
    return typeof parsed?.token === "string" &&
      Number.isInteger(parsed?.pid) &&
      typeof parsed?.cwd === "string"
      ? parsed
      : undefined;
  } catch {
    return undefined;
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

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "EEXIST";
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

function leasePathFor(canonicalCwd: string, leaseRoot: string): string {
  const key = crypto
    .createHash("sha256")
    .update(normalizeIdentity(canonicalCwd))
    .digest("hex");
  return nodePath.join(leaseRoot, `${key}.json`);
}
