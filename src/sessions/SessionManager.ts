import * as crypto from "node:crypto";
import * as nodePath from "node:path";

import * as vscode from "vscode";

import {
  getDefaultArguments,
  getExecutable,
  resolveWorkingDirectory,
} from "../config";
import { detectProjectLauncher } from "../projectLauncher";
import {
  listGitWorktrees,
  sameDirectory,
  type GitWorktree,
} from "../worktrees";
import {
  acquireWriterLease,
  type WriterLease,
} from "../worktreeLease";
import {
  SessionPanel,
  type SessionKind,
  type SessionSpec,
} from "./SessionPanel";
import { SessionTreeProvider } from "./SessionTreeProvider";

const READ_ONLY_TOOLS =
  "read,grep,glob,lsp,inspect_image,browser,web_search,ask,todo";

type DirectoryChoice = vscode.QuickPickItem & {
  cwd?: string;
  branch?: string;
  browse?: boolean;
};

export class SessionManager implements vscode.Disposable {
  readonly tree = new SessionTreeProvider();
  readonly #extensionUri: vscode.Uri;
  #sessions: SessionPanel[] = [];
  #active: SessionPanel | undefined;
  #writerLeases = new Map<string, WriterLease>();

  constructor(extensionUri: vscode.Uri) {
    this.#extensionUri = extensionUri;
  }

  get sessions(): readonly SessionPanel[] {
    return this.#sessions;
  }

  get active(): SessionPanel | undefined {
    return this.#active;
  }

  async newSession(kind: SessionKind = "work"): Promise<SessionPanel | undefined> {
    const directory = await this.#pickDirectory();
    if (!directory) {
      return undefined;
    }

    let resolvedKind = kind;
    if (kind !== "readonly") {
      const conflicting = this.#sessions.find(
        (session) =>
          session.kind !== "readonly" &&
          sameDirectory(session.cwd, directory.cwd),
      );
      if (conflicting) {
        if (kind === "loop") {
          const choice = await vscode.window.showWarningMessage(
            `"${conflicting.label}" already owns write access to this controller directory.`,
            { modal: true },
            "Focus existing",
          );
          if (choice === "Focus existing") {
            conflicting.reveal();
            return conflicting;
          }
          return undefined;
        }
        const choice = await vscode.window.showWarningMessage(
          `"${conflicting.label}" already owns write access to this directory.`,
          { modal: true },
          "Open read-only",
          "Focus existing",
        );
        if (choice === "Focus existing") {
          conflicting.reveal();
          return conflicting;
        }
        if (choice === "Open read-only") {
          resolvedKind = "readonly";
        } else {
          return undefined;
        }
      }
    }

    let loopAlias: string | undefined;
    if (kind === "loop") {
      loopAlias = await vscode.window.showInputBox({
        title: "Loop v2 alias",
        prompt: "Tracked start alias passed to npm run omp:loop",
        validateInput: (value) =>
          /^[a-z0-9][a-z0-9-]{0,63}$/i.test(value.trim())
            ? undefined
            : "Use one simple alias (letters, numbers, hyphens)",
      });
      if (!loopAlias) {
        return undefined;
      }
      loopAlias = loopAlias.trim();
    }

    const baseLabel =
      loopAlias ??
      directory.branch ??
      nodePath.basename(directory.cwd) ??
      "OMP session";
    const label = this.#uniqueLabel(baseLabel);
    let writerLease: WriterLease | undefined;
    if (resolvedKind !== "readonly") {
      const leaseAttempt = await acquireWriterLease(directory.cwd, label);
      if (!leaseAttempt.acquired) {
        const owner = leaseAttempt.owner;
        await vscode.window.showWarningMessage(
          owner
            ? `Worktree already has writing session "${owner.label}" (PID ${owner.pid}). Open read-only or close existing owner first.`
            : "Could not acquire cross-window writer lease for this Git worktree. Open read-only instead.",
          { modal: true },
        );
        return undefined;
      }
      writerLease = leaseAttempt.lease;
    }
    const projectLauncher = detectProjectLauncher(directory.cwd);
    let executable = projectLauncher?.executable ?? getExecutable();
    const args = projectLauncher ? [] : [...getDefaultArguments()];
    if (resolvedKind === "readonly") {
      args.push(
        projectLauncher?.readOnlyArgument ?? `--tools=${READ_ONLY_TOOLS}`,
      );
    } else if (resolvedKind === "loop" && loopAlias) {
      executable = process.platform === "win32" ? "npm.cmd" : "npm";
      args.length = 0;
      args.push("run", "omp:loop", "--", loopAlias);
    }

    const spec: SessionSpec = {
      id: crypto.randomUUID(),
      label,
      cwd: directory.cwd,
      branch: directory.branch,
      kind: resolvedKind,
      executable,
      args,
    };
    let session: SessionPanel;
    try {
      session = new SessionPanel(
        this.#extensionUri,
        spec,
        (disposed) => this.#remove(disposed),
        (activated) => this.#activate(activated),
      );
    } catch (error) {
      await writerLease?.release();
      throw error;
    }
    if (writerLease) {
      this.#writerLeases.set(session.id, writerLease);
    }
    this.#sessions.push(session);
    this.#active = session;
    this.#refresh();
    return session;
  }

  async openOrCreate(): Promise<void> {
    if (this.#active) {
      this.#active.reveal();
      return;
    }
    await this.newSession();
  }

  async resolveTarget(): Promise<SessionPanel | undefined> {
    if (this.#active) {
      return this.#active;
    }
    if (this.#sessions.length === 1) {
      return this.#sessions[0];
    }
    if (this.#sessions.length === 0) {
      return this.newSession();
    }

    const selected = await vscode.window.showQuickPick(
      this.#sessions.map((session) => ({
        label: session.label,
        description:
          session.kind === "readonly"
            ? `${session.branch ?? session.cwd} · read-only`
            : session.branch ?? session.cwd,
        session,
      })),
      { placeHolder: "Choose OMP session" },
    );
    return selected?.session;
  }

  focus(session?: SessionPanel): void {
    const target = session ?? this.#active;
    target?.reveal();
  }

  restart(session?: SessionPanel): void {
    const target = session ?? this.#active;
    if (!target) {
      void vscode.window.showInformationMessage("No OMP session is open.");
      return;
    }
    target.restart();
  }

  search(session?: SessionPanel): void {
    (session ?? this.#active)?.search();
  }

  async rename(session?: SessionPanel): Promise<void> {
    const target = session ?? this.#active;
    if (!target) {
      return;
    }
    const label = await vscode.window.showInputBox({
      title: "Rename OMP session",
      value: target.label,
      prompt: "Editor tab and session-list label",
      validateInput: (value) => (value.trim() ? undefined : "Name is required"),
    });
    if (label === undefined) {
      return;
    }
    target.rename(label);
    this.#refresh();
  }

  close(session?: SessionPanel): void {
    (session ?? this.#active)?.dispose();
  }

  closeAll(): void {
    for (const session of [...this.#sessions]) {
      session.dispose();
    }
  }

  dispose(): void {
    this.closeAll();
    this.tree.dispose();
  }

  async #pickDirectory(): Promise<
    { cwd: string; branch?: string } | undefined
  > {
    const choices = await this.#directoryChoices();
    const selected = await vscode.window.showQuickPick(choices, {
      title: "New OMP session",
      placeHolder: "Choose workspace or Git worktree",
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!selected) {
      return undefined;
    }

    if (selected.browse) {
      const picked = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Open OMP session here",
      });
      const cwd = picked?.[0]?.fsPath;
      return cwd ? { cwd } : undefined;
    }

    return selected.cwd ? { cwd: selected.cwd, branch: selected.branch } : undefined;
  }

  async #directoryChoices(): Promise<DirectoryChoice[]> {
    const roots =
      vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ??
      [resolveWorkingDirectory()];
    const worktrees = new Map<string, GitWorktree>();

    for (const root of roots) {
      const discovered = await listGitWorktrees(root);
      if (discovered.length === 0) {
        worktrees.set(normalizedKey(root), {
          path: root,
          bare: false,
          detached: false,
          prunable: false,
        });
      }
      for (const worktree of discovered) {
        if (!worktree.bare && !worktree.prunable) {
          worktrees.set(normalizedKey(worktree.path), worktree);
        }
      }
    }

    const choices = [...worktrees.values()]
      .sort((left, right) => {
        const leftRoot = roots.some((root) => sameDirectory(root, left.path));
        const rightRoot = roots.some((root) => sameDirectory(root, right.path));
        if (leftRoot !== rightRoot) {
          return leftRoot ? -1 : 1;
        }
        return (left.branch ?? left.path).localeCompare(
          right.branch ?? right.path,
        );
      })
      .map<DirectoryChoice>((worktree) => {
        const active = this.#sessions.filter((session) =>
          sameDirectory(session.cwd, worktree.path),
        );
        const state =
          active.length > 0
            ? `${active.length} live session${active.length === 1 ? "" : "s"}`
            : "available";
        return {
          label: `$(git-branch) ${worktree.branch ?? nodePath.basename(worktree.path)}`,
          description: state,
          detail: worktree.path,
          cwd: worktree.path,
          branch: worktree.branch,
        };
      });

    choices.push({
      label: "$(folder-opened) Choose another folder…",
      description: "Any local project directory",
      browse: true,
    });
    return choices;
  }

  #activate(session: SessionPanel): void {
    this.#active = session;
    this.#refresh();
  }

  #remove(session: SessionPanel): void {
    const lease = this.#writerLeases.get(session.id);
    this.#writerLeases.delete(session.id);
    if (lease) {
      void lease.release();
    }
    this.#sessions = this.#sessions.filter((candidate) => candidate !== session);
    if (this.#active === session) {
      this.#active = this.#sessions.find((candidate) => candidate.active);
    }
    this.#refresh();
  }

  #uniqueLabel(base: string): string {
    const normalized = base.trim() || "OMP session";
    if (!this.#sessions.some((session) => session.label === normalized)) {
      return normalized;
    }
    let suffix = 2;
    while (
      this.#sessions.some(
        (session) => session.label === `${normalized} ${suffix}`,
      )
    ) {
      suffix += 1;
    }
    return `${normalized} ${suffix}`;
  }

  #refresh(): void {
    this.tree.setSessions(this.#sessions);
    void vscode.commands.executeCommand(
      "setContext",
      "ohMyPiSessions.hasSessions",
      this.#sessions.length > 0,
    );
  }
}

function normalizedKey(fsPath: string): string {
  const resolved = nodePath.resolve(fsPath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
