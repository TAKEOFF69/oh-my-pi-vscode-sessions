import * as fs from "node:fs";

export function buildSpawnCommand(
  executable: string,
  extraArgs: readonly string[] = [],
): { file: string; args: string[] } {
  assertSafeOmpRuntime(executable);
  if (isDirectExecutable(executable)) {
    return { file: executable, args: [...extraArgs] };
  }
  if (!isSingleExecutableReference(executable)) {
    throw new Error(
      "OMP executablePath must name a single executable. Put every argument in ohMyPiSessions.defaultArguments.",
    );
  }

  if (process.platform === "win32") {
    return buildWindowsSpawnCommand(executable, extraArgs);
  }

  const shell = process.env.SHELL || "/bin/bash";
  const command = appendShellArguments(executable, extraArgs, quotePosix);
  return { file: shell, args: ["-l", "-c", command] };
}

function buildWindowsSpawnCommand(
  executable: string,
  extraArgs: readonly string[],
): { file: string; args: string[] } {
  const absoluteCandidates = [
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  ];
  const powershellCommand = appendShellArguments(
    executable,
    extraArgs,
    quotePowerShell,
  );

  for (const file of absoluteCandidates) {
    if (fs.existsSync(file)) {
      return { file, args: ["-NoLogo", "-Command", powershellCommand] };
    }
  }

  const comspec = process.env.COMSPEC;
  if (comspec?.toLowerCase().endsWith("cmd.exe")) {
    return {
      file: comspec,
      args: ["/d", "/v:off", "/s", "/c", buildCmdCommand(executable, extraArgs)],
    };
  }

  return {
    file: "powershell.exe",
    args: ["-NoLogo", "-Command", powershellCommand],
  };
}

export function buildPtyEnv(): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;
  return env;
}

export function assertSafeOmpRuntime(executable: string): void {
  const normalized = executable
    .trim()
    .replaceAll("\\", "/")
    .toLowerCase();
  if (
    /(?:^|[\/\s"'`;=&|()])(?:code(?:\s+-\s+(?:insiders|oss))?|code-insiders|codium|vscodium|electron|cursor|windsurf)(?:\.(?:exe|cmd|bat|com|sh))?(?=$|[\s"'`;=&|()])/.test(
      normalized,
    )
  ) {
    throw new Error(
      `Unsafe OMP runtime rejected: ${executable}. VS Code or Electron must never be launched as an OMP child process.`,
    );
  }
}

function isSingleExecutableReference(executable: string): boolean {
  const value = executable.trim();
  return value.length > 0 && !/[\s;&|`$><()]/.test(value);
}

function isDirectExecutable(executable: string): boolean {
  if (!fs.existsSync(executable)) {
    return false;
  }

  if (process.platform === "win32") {
    return executable.toLowerCase().endsWith(".exe");
  }

  return true;
}

function appendShellArguments(
  executable: string,
  args: readonly string[],
  quote: (value: string) => string,
): string {
  if (args.length === 0) {
    return executable;
  }
  return `${executable} ${args.map(quote).join(" ")}`;
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildCmdCommand(
  executable: string,
  args: readonly string[],
): string {
  return appendShellArguments(executable, args, quoteCmd);
}

function quoteCmd(value: string): string {
  return `"${value.replace(/%/g, "%%").replace(/"/g, '""')}"`;
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
