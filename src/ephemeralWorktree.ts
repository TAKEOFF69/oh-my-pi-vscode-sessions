import { execFile } from "node:child_process";
import { readFile, unlink, writeFile } from "node:fs/promises";
import * as nodePath from "node:path";
import { promisify } from "node:util";

import { resolveNodeExecutable } from "./projectLauncher";

const execFileAsync = promisify(execFile);
const MARKER = ".agent-omp-ephemeral.json";

export type EphemeralWorktreeMarker = {
  schema: 1;
  token: string;
  branch: string;
  baseSha: string;
  createdAt: string;
  phase: "unused" | "prompting";
};

export async function reserveEphemeralWorktree(
  cwd: string,
  token: string,
): Promise<boolean> {
  const marker = await readEphemeralWorktreeMarker(cwd);
  if (!marker || marker.token !== token || marker.phase !== "unused") {
    return false;
  }
  try {
    await writeFile(
      nodePath.join(cwd, MARKER),
      `${JSON.stringify({ ...marker, phase: "prompting" }, null, 2)}\n`,
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

export async function releaseEphemeralWorktreeReservation(
  cwd: string,
  token: string,
): Promise<boolean> {
  const marker = await readEphemeralWorktreeMarker(cwd);
  if (!marker || marker.token !== token || marker.phase !== "prompting") {
    return false;
  }
  try {
    await writeFile(
      nodePath.join(cwd, MARKER),
      `${JSON.stringify({ ...marker, phase: "unused" }, null, 2)}\n`,
      "utf8",
    );
    return true;
  } catch {
    return false;
  }
}

export async function readEphemeralWorktreeMarker(
  cwd: string,
): Promise<EphemeralWorktreeMarker | undefined> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(nodePath.join(cwd, MARKER), "utf8"),
    );
    if (!isValidMarker(parsed)) return undefined;
    return { ...parsed, phase: parsed.phase ?? "unused" };
  } catch {
    return undefined;
  }
}

export async function claimEphemeralWorktree(
  cwd: string,
  token: string,
): Promise<boolean> {
  const markerPath = nodePath.join(cwd, MARKER);
  const parsed = await readEphemeralWorktreeMarker(cwd);
  if (!parsed || !isOwnedMarker(parsed, token) || parsed.phase !== "prompting") {
    return false;
  }
  await unlink(markerPath);
  return true;
}

export async function cleanupUnusedEphemeralWorktree(options: {
  cleanupRoot: string;
  cwd: string;
  token: string;
}): Promise<void> {
  const script = nodePath.join(
    options.cleanupRoot,
    "scripts",
    "agent",
    "cleanup-worktree.mjs",
  );
  await execFileAsync(
    resolveNodeExecutable(),
    [
      script,
      options.cwd,
      "--ephemeral-unused",
      `--ephemeral-token=${options.token}`,
    ],
    {
      cwd: options.cleanupRoot,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    },
  );
}

function isOwnedMarker(value: unknown, token: string): boolean {
  return isValidMarker(value) && value.token === token;
}

function isValidMarker(value: unknown): value is EphemeralWorktreeMarker {
  if (!value || typeof value !== "object") return false;
  const marker = value as Record<string, unknown>;
  return marker.schema === 1 &&
    typeof marker.token === "string" &&
    /^[0-9a-f-]{36}$/i.test(marker.token) &&
    typeof marker.branch === "string" &&
    /^wip\/\d{8}-omp-(?:loop-)?session-[a-z0-9][a-z0-9-]{0,31}$/i.test(
      marker.branch,
    ) &&
    typeof marker.baseSha === "string" &&
    /^[0-9a-f]{40}$/i.test(marker.baseSha) &&
    typeof marker.createdAt === "string" &&
    Number.isFinite(Date.parse(marker.createdAt)) &&
    (marker.phase === undefined ||
      marker.phase === "unused" ||
      marker.phase === "prompting");
}
