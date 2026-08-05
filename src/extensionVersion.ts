import { readFileSync } from "node:fs";
import * as nodePath from "node:path";

export const EXTENSION_ID = "takeoff69.oh-my-pi-vscode-sessions";

export type ExtensionVersionState = {
  loaded: string;
  installed?: string;
  reloadRequired: boolean;
};

export function inspectExtensionVersion(
  extensionPath: string,
  loaded: string,
  readText: (filePath: string) => string = (filePath) => readFileSync(filePath, "utf8"),
): ExtensionVersionState {
  const catalogPath = nodePath.join(nodePath.dirname(extensionPath), "extensions.json");
  let raw: unknown;
  try {
    raw = JSON.parse(readText(catalogPath));
  } catch {
    return { loaded, reloadRequired: false };
  }
  const versions = Array.isArray(raw)
    ? raw
        .filter((entry) => isRecord(entry) && isRecord(entry.identifier))
        .filter((entry) => String(entry.identifier.id).toLowerCase() === EXTENSION_ID)
        .map((entry) => String(entry.version ?? ""))
        .filter((version) => parseVersion(version) !== undefined)
    : [];
  const installed = versions.sort(compareVersions).at(-1);
  return {
    loaded,
    ...(installed ? { installed } : {}),
    reloadRequired: Boolean(installed && compareVersions(loaded, installed) < 0),
  };
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left) ?? [0, 0, 0];
  const b = parseVersion(right) ?? [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function parseVersion(value: string): [number, number, number] | undefined {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
