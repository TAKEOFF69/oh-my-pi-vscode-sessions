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
import type { PromptImage } from "../promptImages";
import {
  canonicalDzialkiOrigin,
  detectProjectLauncher,
  type ProjectLauncher,
  warmCanonicalDzialkiAdapterSnapshot,
} from "../projectLauncher";
import {
  bootstrapWorktree,
  provisionGitWorktree,
} from "../dzialkiWorktree";
import {
  LoopHandoffSingleFlight,
  sameLoopAlias,
} from "../loopHandoff";
import { SessionCreationGate } from "../sessionCreationGate";
import { deriveSessionTitle } from "../sessionTitle";
import {
  planAutomaticDirectory,
  provisionManagementRoot,
} from "../sessionDirectory";
import {
  SessionSidebarProvider,
  type SidebarSession,
} from "../sidebar/SessionSidebarProvider";
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
import {
  RecentSessionStore,
  type RecentSessionRecord,
} from "./RecentSessionStore";
import { clearSessionSelection } from "./sessionSelection";

type DirectoryChoice = vscode.QuickPickItem & {
  cwd?: string;
  branch?: string;
  browse?: boolean;
};

type DirectoryMode = "auto" | "choose";

export class SessionManager implements vscode.Disposable {
  readonly sidebar: SessionSidebarProvider;
  readonly #extensionUri: vscode.Uri;
  readonly #logger: SessionLogger;
  readonly #recent: RecentSessionStore;
  #sessions: SessionPanel[] = [];
  #active: SessionPanel | undefined;
  #writerLeases = new Map<string, WriterLease>();
  #validatedLaunchers = new Map<string, ProjectLauncher>();
  #creationQueue: Promise<void> = Promise.resolve();
  #primarySessionGate =
    new SessionCreationGate<SessionPanel | undefined>({
      cooldownMs: 1_500,
    });
  #loopHandoffs =
    new LoopHandoffSingleFlight<SessionPanel | undefined>();
  #acceptingSessions = true;
  #shutdownPromise: Promise<void> | undefined;
  #resumeFlights = new Map<string, Promise<SessionPanel | undefined>>();

  constructor(
    extensionUri: vscode.Uri,
    logger: SessionLogger,
    workspaceState: vscode.Memento,
  ) {
    this.#extensionUri = extensionUri;
    this.#logger = logger;
    this.#recent = new RecentSessionStore(workspaceState);
    this.sidebar = new SessionSidebarProvider(extensionUri, {
      createSession: async (draft) =>
        Boolean(
          await this.newPrimarySession(draft.message, draft.images),
        ),
      focusSession: (id) => this.openSession(id),
      clearActiveSession: () => this.#clearActiveSession(),
      showLogs: () => this.#logger.show(),
    });
    this.#refresh();
    this.sidebar.setProfile({
      accessLabel: "Custom access",
      modelLabel: "Opus 5 · Extra High",
      modelDetail: "Opus 5 Extra High driver; GPT-5.6 Sol Extra High advisor configured",
    });
  }

  get sessions(): readonly SessionPanel[] {
    return this.#sessions;
  }

  get active(): SessionPanel | undefined {
    return this.#active;
  }

  focusNewSession(): void {
    this.sidebar.focusComposer(true);
  }

  newPrimarySession(
    initialPrompt?: string,
    initialImages: readonly PromptImage[] = [],
  ): Promise<SessionPanel | undefined> {
    const prompt = initialPrompt;
    if (!prompt?.trim()) {
      this.focusNewSession();
      return Promise.resolve(undefined);
    }
    return this.#primarySessionGate.run(
      () =>
        this.newSession(
          "work",
          "rpc",
          "auto",
          undefined,
          prompt,
          initialImages,
        ),
      (reason) =>
        this.#logger.info(
          `Ignored duplicate New Session request (${reason})`,
        ),
    );
  }

  newSession(
    kind: SessionKind = "work",
    transport: SessionTransport = "rpc",
    directoryMode: DirectoryMode = "auto",
    requestedLoopAlias?: string,
    initialPrompt?: string,
    initialImages: readonly PromptImage[] = [],
    resume?: RecentSessionRecord,
  ): Promise<SessionPanel | undefined> {
    if (!this.#acceptingSessions) {
      return Promise.resolve(undefined);
    }
    const opening = this.#creationQueue.then(() =>
      this.#createSession(
        kind,
        transport,
        directoryMode,
        requestedLoopAlias,
        initialPrompt,
        initialImages,
        resume,
      ),
    );
    this.#creationQueue = opening.then(
      () => undefined,
      () => undefined,
    );
    return opening;
  }

  async #createSession(
    kind: SessionKind,
    transport: SessionTransport,
    directoryMode: DirectoryMode,
    requestedLoopAlias?: string,
    initialPrompt?: string,
    initialImages: readonly PromptImage[] = [],
    resume?: RecentSessionRecord,
  ): Promise<SessionPanel | undefined> {
    this.#logger.info(`New ${kind} ${transport} session requested`);
    let loopAlias = requestedLoopAlias?.trim();
    if (kind === "loop") {
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
      const existing = this.#sessions.find(
        (session) =>
          session.kind === "loop" &&
          sameLoopAlias(session.loopAlias, loopAlias as string),
      );
      if (existing) {
        existing.reveal();
        return existing;
      }
    }

    const directory = resume
      ? { cwd: resume.cwd, branch: resume.branch }
      : directoryMode === "choose"
        ? await this.#pickDirectory()
        : await this.#automaticDirectory(kind);
    if (!directory) {
      this.#logger.info(`New ${kind} session cancelled before directory selection`);
      return undefined;
    }
    if (
      resume &&
      (!existsSync(directory.cwd) || !existsSync(resume.sessionFile))
    ) {
      await vscode.window.showErrorMessage(
        "OMP Sessions: Saved chat cannot be reopened because its exact worktree or OMP session file is missing.",
      );
      return undefined;
    }
    this.#logger.info(
      `Selected ${kind} session directory ${directory.cwd}${directory.branch ? ` (${directory.branch})` : ""}`,
    );

    let projectLauncher;
    try {
      const key = normalizedKey(directory.cwd);
      projectLauncher = this.#validatedLaunchers.get(key);
      this.#validatedLaunchers.delete(key);
      projectLauncher ??= await detectProjectLauncher(directory.cwd);
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

    const baseLabel =
      resume?.label ??
      loopAlias ??
      (initialPrompt ? deriveSessionTitle(initialPrompt) : undefined) ??
      (kind === "readonly" ? "Read-only chat" : "New chat");
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
        roleConfigPath: vscode.Uri.joinPath(
          this.#extensionUri,
          "config",
          "driver.yml",
        ).fsPath,
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
      id: resume?.id ?? crypto.randomUUID(),
      label,
      ...(loopAlias ? { loopAlias } : {}),
      cwd: directory.cwd,
      branch: directory.branch,
      kind: resolvedKind,
      persistedKind: resume?.kind ?? resolvedKind,
      transport,
      executable: launch.executable,
      args: launch.args,
      initialPrompt: resume
        ? undefined
        : initialPrompt ?? launch.initialPrompt,
      initialImages: resume ? undefined : initialImages,
      resumeSessionFile: resume?.sessionFile,
      titleSource: resume?.titleSource ??
        (initialPrompt ? "provisional" : "runtime"),
      updatedAt: resume?.updatedAt,
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
    session.reveal();
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
        sameLoopAlias(session.loopAlias, alias),
    );
    if (existing) {
      existing.reveal();
      return;
    }
    const flight = this.#loopHandoffs.joinOrStart(alias, () => {
      this.#logger.info(
        `Opening isolated Loop controller "${alias}" from "${source.label}"`,
      );
      return this.newSession("loop", "rpc", "auto", alias);
    });
    const opened = await flight.promise;
    if (!flight.started) {
      opened?.reveal();
    } else if (opened) {
      await vscode.window.showInformationMessage(
        `Loop "${alias}" opened in isolated controller chat.`,
      );
    }
  }

  async openOrCreate(): Promise<void> {
    if (this.#active) {
      this.#active.reveal();
      return;
    }
    this.focusNewSession();
  }

  async openSession(id: string): Promise<void> {
    const live = this.#sessions.find((session) => session.id === id);
    if (live) {
      live.reveal();
      return;
    }
    const record = this.#recent.find(id);
    if (!record) return;
    const existing = this.#resumeFlights.get(id);
    if (existing) {
      (await existing)?.reveal();
      return;
    }
    const opening = this.newSession(
      record.kind,
      record.transport,
      "auto",
      record.loopAlias,
      undefined,
      [],
      record,
    );
    this.#resumeFlights.set(id, opening);
    try {
      (await opening)?.reveal();
    } finally {
      this.#resumeFlights.delete(id);
    }
  }

  async resolveTarget(): Promise<SessionPanel | undefined> {
    if (this.#active) {
      return this.#active;
    }
    if (this.#sessions.length === 1) {
      return this.#sessions[0];
    }
    if (this.#sessions.length === 0) {
      return this.newPrimarySession();
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
      prompt: "Conversation and recent-chat label",
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
      this.#acceptingSessions = false;
      this.#shutdownPromise = (async () => {
        await this.#creationQueue;
        await this.closeAll();
        await this.#recent.flush();
        this.sidebar.dispose();
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
    const startedAt = Date.now();
    const roots = this.#workspaceRoots();
    const [worktrees, identity] = await Promise.all([
      this.#discoverWorktrees(roots),
      repositoryIdentity(roots[0]),
    ]);
    this.#logger.info(
      `OMP session repository discovery: ${Date.now() - startedAt} ms`,
    );
    const plan = planAutomaticDirectory({
      workspaceRoots: roots,
      worktrees,
      activeWriterCwds: this.#sessions
        .filter((session) => session.kind !== "readonly")
        .map((session) => session.cwd),
      kind,
      canonicalDzialki: canonicalDzialkiOrigin(identity?.origin),
      gitRepository: Boolean(identity),
      launcherExists: (cwd) =>
        existsSync(nodePath.join(cwd, "scripts", "omp", "launch.mjs")),
    });
    if (plan.action === "use") {
      this.#logger.info(
        `Automatic ${kind} directory: ${plan.directory.cwd}`,
      );
      return plan.directory;
    }
    if (plan.action === "create") {
      const isDzialki = canonicalDzialkiOrigin(identity?.origin);
      const managementRoot = provisionManagementRoot({
        currentRepositoryRoot: identity?.root,
        worktrees,
        canonicalDzialki: isDzialki,
      });
      if (!managementRoot) {
        await vscode.window.showErrorMessage(
          "OMP Sessions: Could not locate canonical Dzialkopedia checkout for isolated session.",
        );
        return undefined;
      }
      try {
        let validatedLauncher: ProjectLauncher | undefined;
        if (isDzialki) warmCanonicalDzialkiAdapterSnapshot();
        const created = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Window,
            title: "Preparing isolated OMP session",
          },
          () =>
            provisionGitWorktree(managementRoot, plan.role, {
              baseRef: isDzialki ? "origin/main" : "HEAD",
              fetchOriginMain: isDzialki,
              configureHooks: isDzialki,
              bootstrap: isDzialki
                ? bootstrapWorktree
                : async () => undefined,
              reportPhase: (phase, elapsedMs) => {
                this.#logger.info(
                  `OMP worktree ${phase}: ${elapsedMs} ms`,
                );
              },
              validate: async (worktree) => {
                validatedLauncher = await detectProjectLauncher(
                  worktree.cwd,
                );
                if (isDzialki && !validatedLauncher) {
                  throw new Error(
                    "Fresh Dzialkopedia worktree has no canonical launcher",
                  );
                }
              },
            }),
        );
        if (validatedLauncher) {
          this.#validatedLaunchers.set(
            normalizedKey(created.cwd),
            validatedLauncher,
          );
        }
        this.#logger.info(
          `Created isolated ${plan.role} worktree ${created.cwd} (${created.branch})`,
        );
        return created;
      } catch (error) {
        await vscode.window.showErrorMessage(
          `OMP Sessions: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return undefined;
      }
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
    const discoveries = await Promise.all(
      roots.map(async (root) => ({
        root,
        discovered: await listGitWorktrees(root),
      })),
    );
    for (const { root, discovered } of discoveries) {
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
    for (const candidate of this.#sessions) {
      candidate.setActive(candidate === session);
    }
    session.setActive(true);
    this.#active = session;
    if (session.rpcHost) {
      this.sidebar.showSession(session.id, session.rpcHost);
    }
    this.#refresh();
  }

  #clearActiveSession(): void {
    this.#active = clearSessionSelection(this.#sessions);
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
      this.sidebar.showHome(false);
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
    for (const session of this.#sessions) {
      if (!session.sessionFile || session.transport !== "rpc") continue;
      this.#recent.upsert({
        id: session.id,
        label: session.label,
        cwd: session.cwd,
        ...(session.branch ? { branch: session.branch } : {}),
        ...(session.loopAlias ? { loopAlias: session.loopAlias } : {}),
        kind: session.persistedKind,
        transport: "rpc",
        sessionFile: session.sessionFile,
        updatedAt: session.updatedAt,
        titleSource: session.titleSource,
      });
    }
    const liveIds = new Set(this.#sessions.map((session) => session.id));
    const rows: SidebarSession[] = [
      ...this.#sessions.map((session) => ({
        id: session.id,
        label: session.label,
        kind: session.kind,
        status: session.status,
        active: session.active,
        live: true,
        updatedAt: session.updatedAt,
      })),
      ...this.#recent
        .list()
        .filter((record) => !liveIds.has(record.id))
        .map((record) => ({
          id: record.id,
          label: record.label,
          kind: record.kind,
          status: "closed" as const,
          active: false,
          live: false,
          updatedAt: record.updatedAt,
        })),
    ].sort((left, right) => right.updatedAt - left.updatedAt);
    this.sidebar.setSessions(rows);
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
