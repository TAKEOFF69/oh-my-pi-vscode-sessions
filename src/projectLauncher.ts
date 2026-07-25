import { existsSync } from "node:fs";
import * as nodePath from "node:path";

export type ProjectLauncher = {
  executable: string;
  readOnlyArgument: string;
};

export function detectProjectLauncher(
  cwd: string,
  pathExists: (candidate: string) => boolean = existsSync,
): ProjectLauncher | undefined {
  const launcher = nodePath.join(cwd, "scripts", "omp", "launch.mjs");
  return pathExists(launcher)
    ? {
        executable: "node scripts/omp/launch.mjs",
        readOnlyArgument: "--read-only",
      }
    : undefined;
}
