import * as crypto from "node:crypto";
import { existsSync } from "node:fs";
import * as nodePath from "node:path";

import * as vscode from "vscode";

import {
  getDefaultArguments,
  getExecutable,
  resolveWorkingDirectory,
} from "../config";
import type { SessionLogger } from "../logging";
import {
  canonicalDzialkiOrigin,
  detectProjectLauncher,
} from "../projectLauncher";
import { planAutomaticDirectory } from "../sessionDirectory";
import {
  listGitWorktrees,
  repositoryIdentity,
  sameDirectory,
  type GitWorktree,
} from "../worktrees";
import {
  acquireWriterLease,
  type WriterLease,
} from "../worktreeLease";
import {
  buildSessionLaunchPlan,
  canOfferReadOnlyDowngrade,
  resolveEffectiveSessionKind,
} from "../sessionLaunch";
import {
  SessionPanel,
  type SessionKind,
  type SessionSpec,
  type SessionTransport,
} from "./SessionPanel";
import { SessionTreeProvider } from "./SessionTreeProvider";

type DirectoryChoice = vscode.QuickPickItem & {
  cwd?: string;
  branch?: string;
  browse?: boolean;
};

type DirectoryMode = "auto" | "choose";

export class SessionManager implements vscode.Disposable {
  readonly tree = new SessionTreeProvider();
  readonly #extensionUri: vscode.Uri;
  readonly #logger: SessionLogger;
  #sessions: SessionPanel[] = [];
  #active: SessionPanel | undefined;
  #writerLeases = new Map<string, WriterLease>();
  #shutdownPromise: Promise<void> | undefined;

  constructor(extensionUri: vscode.Uri, logger: SessionLogger) {
    this.#extensionUri = extensionUri;
    this.#logger = logger;
  }

  get sessions(): readonly SessionPanel[] {
    return this.#sessions;
  }

  get active(): SessionPanel | undefined {
    return this.#active;
  }

  async newSession(
    kind: SessionKind = "work",
    transport: SessionTransport = "rpc",
    directoryMode: DirectoryMode = "auto",
    requestedLoopAlias?: string,
  ): Promise<SessionPanel | undefined> {
    this.#logger.info(`New ${kind} ${transport} session requested`);
    const directory =
      directoryMode === "choose"
        ? await this.#pickDirectory()
        : await this.#automaticDirectory(kind);
    if (!directory) {
      this.#logger.info(`New ${kind} session cancelled before directory selection`);
      return undefined;
    }
    this.#logger.info(
      `Selected ${kind} session directory ${directory.cwd}${directory.branch ? ` (${directory.branch})` : ""}`,
    );

    let projectLauncher;
    try {
      projectLauncher = await detectProjectLauncher(directory.cwd);
    } catch (error) {
      await vscode.window.showErrorMessage(
        `OMP Sessions: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }
    const safety = resolveEffectiveSessionKind(
      transport === "terminal" ? "readonly" : kind,
      transport,
      Boolean(projectLauncher),
    );
    if (safety.blockReason) {
      await vscode.window.showErrorMessage(
        `OMP Sessions: ${safety.blockReason}`,
      );
      return undefined;
    }
    let resolvedKind = safety.kind;
    if (
      transport === "terminal" &&
      resolvedKind === "work" &&
      !projectLauncher
    ) {
      this.#logger.info(
        "Generic diagnostic TUI is writer-capable and will acquire the worktree writer lease",
      );
    }
    if (resolvedKind !== "readonly") {
      const conflicting = this.#sessions.find(
        (session) =>
          session.kind !== "readonly" &&
          sameDirectory(session.cwd, directory.cwd),
      );
      if (conflicting) {
        if (resolvedKind === "loop") {
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
        const allowReadOnly = canOfferReadOnlyDowngrade(
          Boolean(projectLauncher),
        );
        const choice = allowReadOnly
          ? await vscode.window.showWarningMessage(
              `"${conflicting.label}" already owns write access to this directory.`,
              { modal: true },
              "Open read-only",
              "Focus existing",
            )
          : await vscode.window.showWarningMessage(
              `"${conflicting.label}" already owns write access to this directory. Generic OMP cannot prove a read-only tool surface.`,
              { modal: true },
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
    const finalSafety = resolveEffectiveSessionKind(
      resolvedKind,
      transport,
      Boolean(projectLauncher),
    );
    if (finalSafety.blockReason) {
      await vscode.window.showErrorMessage(
        `OMP Sessions: ${finalSafety.blockReason}`,
      );
      return undefined;
    }
    resolvedKind = finalSafety.kind;

    let loopAlias = requestedLoopAlias?.trim();
    if (resolvedKind === "loop") {
      if (
        loopAlias &&
        !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(loopAlias)
      ) {
        await vscode.window.showErrorMessage(
          "OMP Sessions: Loop alias must use only letters, numbers, and hyphens.",
        );
        return undefined;
      }
      loopAlias ??= await vscode.window.showInputBox({
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
    let launch;
    try {
      launch = buildSessionLaunchPlan({
        kind: resolvedKind,
        transport,
        cwd: directory.cwd,
        loopAlias,
        projectLauncher,
        fallbackExecutable: getExecutable(),
        defaultArguments: getDefaultArguments(),
      });
    } catch (error) {
      await writerLease?.release();
      await vscode.window.showErrorMessage(
        `OMP Sessions: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return undefined;
    }

    const spec: SessionSpec = {
      id: crypto.randomUUID(),
      label,
      cwd: directory.cwd,
      branch: directory.branch,
      kind: resolvedKind,
      transport,
      executable: launch.executable,
      args: launch.args,
      initialPrompt: launch.initialPrompt,
      parity: launch.parity,
    };
    this.#logger.info(
      `Starting "${label}" as ${resolvedKind}/${transport}; executable=${launch.executable}; projectLauncher=${projectLauncher ? "yes" : "no"}`,
    );
    let session: SessionPanel;
    try {
      session = new SessionPanel(
        this.#extensionUri,
        spec,
        (disposed) => this.#remove(disposed),
        (activated) => this.#activate(activated),
        () => this.#refresh(),
        (alias, source) => this.#handoffToLoop(alias, source),
        this.#logger,
      );
    } catch (error) {
      this.#logger.error(`Failed to create "${label}"`, error);
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

  async #handoffToLoop(
    alias: string,
    source: SessionPanel,
  ): Promise<void> {
    const existing = this.#sessions.find(
      (session) =>
        session.kind === "loop" &&
        session.label.toLowerCase() === alias.toLowerCase(),
    );
    if (existing) {
      existing.reveal();
      return;
    }
    this.#logger.info(
      `Opening isolated Loop controller "${alias}" from "${source.label}"`,
    );
    const opened = await this.newSession(
      "loop",
      "rpc",
      "auto",
      alias,
    );
    if (opened) {
      await vscode.window.showInformationMessage(
        `Loop "${alias}" opened in isolated controller tab.`,
      );
    }
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
    void target.restart();
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

  async closeAll(): Promise<void> {
    await Promise.all(
      [...this.#sessions].map((session) => session.shutdown()),
    );
  }

  dispose(): void {
    void this.shutdown().catch((error) => {
      this.#logger.error("Failed to shut down all OMP sessions", error);
    });
  }

  shutdown(): Promise<void> {
    if (!this.#shutdownPromise) {
      this.#shutdownPromise = (async () => {
        await this.closeAll();
        this.tree.dispose();
      })();
    }
    return this.#shutdownPromise;
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

    return selected.cwd
      ? { cwd: selected.cwd, branch: selected.branch }
      : undefined;
  }

  async #automaticDirectory(
    kind: SessionKind,
  ): Promise<{ cwd: string; branch?: string } | undefined> {
    const roots = this.#workspaceRoots();
    const worktrees = await this.#discoverWorktrees(roots);
    const identity = await repositoryIdentity(roots[0]);
    const plan = planAutomaticDirectory({
      workspaceRoots: roots,
      worktrees,
      activeWriterCwds: this.#sessions
        .filter((session) => session.kind !== "readonly")
        .map((session) => session.cwd),
      kind,
      canonicalDzialki: canonicalDzialkiOrigin(identity?.origin),
      launcherExists: (cwd) =>
        existsSync(nodePath.join(cwd, "scripts", "omp", "launch.mjs")),
    });
    if (plan.action === "use") {
      this.#logger.info(
        `Automatic ${kind} directory: ${plan.directory.cwd}`,
      );
      return plan.directory;
    }

    const choice = await vscode.window.showWarningMessage(
      `OMP Sessions: ${plan.reason} Shared Dzialkopedia main is intentionally excluded. Create a worktree with "npm run agent:start -- <arc>", or choose an existing worktree.`,
      "Choose worktree",
    );
    return choice === "Choose worktree"
      ? this.#pickDirectory()
      : undefined;
  }

  async #directoryChoices(): Promise<DirectoryChoice[]> {
    const roots = this.#workspaceRoots();
    const worktrees = await this.#discoverWorktrees(roots);

    const choices = [...worktrees]
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

  #workspaceRoots(): string[] {
    return (
      vscode.workspace.workspaceFolders?.map(
        (folder) => folder.uri.fsPath,
      ) ?? [resolveWorkingDirectory()]
    );
  }

  async #discoverWorktrees(
    roots: readonly string[],
  ): Promise<GitWorktree[]> {
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
    return [...worktrees.values()];
  }

  #activate(session: SessionPanel): void {
    this.#active = session;
    this.#refresh();
  }

  async #remove(session: SessionPanel): Promise<void> {
    this.#logger.info(
      `Closed "${session.label}" (${session.kind}, ${session.cwd})`,
    );
    const lease = this.#writerLeases.get(session.id);
    this.#writerLeases.delete(session.id);
    if (lease) {
      await lease.release();
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
