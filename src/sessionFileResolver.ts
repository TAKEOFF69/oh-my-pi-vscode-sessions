import { existsSync, statSync } from "node:fs";
import * as nodePath from "node:path";

export function resolveSessionFile(
  cwd: string,
  requestedPath: string,
  isFile: (candidate: string) => boolean = defaultIsFile,
): string | undefined {
  if (!requestedPath || requestedPath.startsWith("~")) return undefined;
  const root = nodePath.resolve(cwd);
  const candidate = nodePath.resolve(root, requestedPath);
  const relative = nodePath.relative(root, candidate);
  if (
    relative === ".." ||
    relative.startsWith(`..${nodePath.sep}`) ||
    nodePath.isAbsolute(relative)
  ) return undefined;
  return isFile(candidate) ? candidate : undefined;
}

function defaultIsFile(candidate: string): boolean {
  try {
    return existsSync(candidate) && statSync(candidate).isFile();
  } catch {
    return false;
  }
}
