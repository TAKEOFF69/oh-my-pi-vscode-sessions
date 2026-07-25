import * as fs from "node:fs";

export function buildSpawnCommand(
  executable: string,
  extraArgs: readonly string[] = [],
): { file: string; args: string[] } {
  if (isDirectExecutable(executable)) {
    return { file: executable, args: [...extraArgs] };
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
  const command = appendShellArguments(executable, extraArgs, quotePowerShell);

  for (const file of absoluteCandidates) {
    if (fs.existsSync(file)) {
      return { file, args: ["-NoLogo", "-Command", command] };
    }
  }

  const comspec = process.env.COMSPEC;
  if (comspec?.toLowerCase().endsWith("cmd.exe")) {
    return { file: comspec, args: ["/d", "/c", command] };
  }

  return { file: "powershell.exe", args: ["-NoLogo", "-Command", command] };
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

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
