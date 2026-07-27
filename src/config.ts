import * as fs from "node:fs";
import * as os from "node:os";
import * as vscode from "vscode";

import { DEFAULT_TERMINAL_FONT, type TerminalFont } from "./appearance";

export function getExecutable(): string {
  const config = vscode.workspace.getConfiguration("ohMyPiSessions");
  const configured = config.get<string>("executablePath")?.trim();
  if (configured) {
    return configured;
  }

  // Preserve the marketplace extension's setting during migration.
  const legacy = vscode.workspace
    .getConfiguration("ohMyPi")
    .get<string>("executablePath")
    ?.trim();
  if (legacy) {
    return legacy;
  }

  for (const candidate of platformExecutableCandidates()) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Continue through candidates.
    }
  }

  return "omp";
}

function getWorkingDirectory(): string {
  const config = vscode.workspace.getConfiguration("ohMyPiSessions");
  const configured = config.get<string>("workingDirectory")?.trim();
  if (configured) {
    return configured;
  }

  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
}

export function resolveWorkingDirectory(): string {
  const cwd = getWorkingDirectory();

  try {
    if (fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()) {
      return cwd;
    }
  } catch {
    // fall through to home
  }

  return os.homedir();
}

export function getTerminalFont(): TerminalFont {
  const config = vscode.workspace.getConfiguration("terminal.integrated");
  return {
    family: config.get<string>("fontFamily") || DEFAULT_TERMINAL_FONT.family,
    size: config.get<number>("fontSize") ?? DEFAULT_TERMINAL_FONT.size,
  };
}

export function getDefaultArguments(): string[] {
  const config = vscode.workspace.getConfiguration("ohMyPiSessions");
  return config
    .get<string[]>("defaultArguments", [])
    .map((value) => value.trim())
    .filter(Boolean);
}

function platformExecutableCandidates(): string[] {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    const userProfile = process.env.USERPROFILE;
    const appData = process.env.APPDATA;
    return [
      localAppData ? `${localAppData}\\omp\\omp.exe` : "",
      userProfile ? `${userProfile}\\.bun\\bin\\omp.exe` : "",
      appData ? `${appData}\\npm\\omp.cmd` : "",
    ].filter(Boolean);
  }

  return [
    `${os.homedir()}/.local/bin/omp`,
    `${os.homedir()}/.bun/bin/omp`,
    "/usr/local/bin/omp",
  ];
}
