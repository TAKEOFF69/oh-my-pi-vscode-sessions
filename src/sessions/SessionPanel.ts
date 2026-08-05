import * as vscode from "vscode";

import type { SessionLogger } from "../logging";
import type { PromptImage } from "../promptImages";
import type { RpcParityProfile } from "../rpc/parity";
import { RpcSessionHost } from "../rpc/RpcSessionHost";
import { TerminalSessionHost } from "../terminal/TerminalSessionHost";
import type { SessionHost } from "./SessionHost";
import {
  normalizeRuntimeSessionTitle,
  shouldAcceptSessionTitle,
  type SessionTitleSource,
} from "../sessionTitle";

export type SessionKind = "work" | "readonly" | "loop";
export type SessionTransport = "rpc" | "terminal";
export type SessionStatus =
  | "starting"
  | "idle"
  | "running"
  | "finished"
  | "failed";

export type SessionSpec = {
  id: string;
  label: string;
  loopAlias?: string;
  cwd: string;
  branch?: string;
  kind: SessionKind;
  transport: SessionTransport;
  executable: string;
  args: readonly string[];
  initialPrompt?: string;
  initialImages?: readonly PromptImage[];
  resumeSessionFile?: string;
  titleSource?: SessionTitleSource;
  updatedAt?: number;
  parity?: RpcParityProfile;
  persistedKind?: SessionKind;
};

export class SessionPanel implements vscode.Disposable {
  static readonly viewType = "ohMyPiSessions.session";

  readonly panel: vscode.WebviewPanel | undefined;
  readonly #host: SessionHost;
  readonly #rpcHost: RpcSessionHost | undefined;
  readonly #onDisposed: (session: SessionPanel) => void | Promise<void>;
  readonly #onActivated: (session: SessionPanel) => void;
  readonly #onChanged: (session: SessionPanel) => void;
  readonly #logger: SessionLogger;
  #disposed = false;
  #active = false;
  #disposePromise: Promise<void> | undefined;
  #status: SessionStatus = "starting";
  #spec: SessionSpec;
  #sessionFile: string | undefined;
  #titleSource: SessionTitleSource;
  #updatedAt: number;
  #disposables: vscode.Disposable[] = [];

  constructor(
    extensionUri: vscode.Uri,
    spec: SessionSpec,
    onDisposed: (session: SessionPanel) => void | Promise<void>,
    onActivated: (session: SessionPanel) => void,
    onChanged: (session: SessionPanel) => void,
    onLoopHandoff: (
      alias: string,
      source: SessionPanel,
    ) => void | Promise<void>,
    logger: SessionLogger,
  ) {
    this.#spec = spec;
    this.#onDisposed = onDisposed;
    this.#onActivated = onActivated;
    this.#onChanged = onChanged;
    this.#logger = logger;
    this.#sessionFile = spec.resumeSessionFile;
    this.#titleSource = spec.titleSource ?? "runtime";
    this.#updatedAt = spec.updatedAt ?? Date.now();

    const statusChanged = (status: SessionStatus) => {
      this.#status = status;
      this.#updatedAt = Date.now();
      this.#onChanged(this);
    };

    if (spec.transport === "rpc") {
      this.panel = undefined;
      this.#rpcHost = new RpcSessionHost({
        cwd: spec.cwd,
        branch: spec.branch,
        kind: spec.kind,
        executable: spec.executable,
        args: spec.args,
        initialPrompt: spec.initialPrompt,
        initialImages: spec.initialImages,
        resumeSessionFile: spec.resumeSessionFile,
        parity: spec.parity,
        logger,
        label: spec.label,
        onStatusChange: statusChanged,
        onTitleChange: (title, source) => {
          if (!shouldAcceptSessionTitle(this.#titleSource, source)) {
            return false;
          }
          const accepted = normalizeRuntimeSessionTitle(
            title,
            this.#spec.branch,
            this.#spec.cwd,
          );
          if (!accepted) return false;
          this.#spec = { ...this.#spec, label: accepted };
          this.#titleSource = "runtime";
          this.#updatedAt = Date.now();
          this.#onChanged(this);
          return true;
        },
        onSessionFileChange: (sessionFile) => {
          this.#sessionFile = sessionFile;
          this.#onChanged(this);
        },
        onLoopHandoff: (alias) => onLoopHandoff(alias, this),
      });
      this.#host = this.#rpcHost;
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      SessionPanel.viewType,
      this.#title(),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    this.panel = panel;
    this.#rpcHost = undefined;
    panel.iconPath = vscode.Uri.joinPath(
      extensionUri,
      "media",
      "activity-icon.svg",
    );
    this.#host = new TerminalSessionHost({
      extensionUri,
      webview: panel.webview,
      cwd: spec.cwd,
      executable: spec.executable,
      args: spec.args,
      logger,
      label: spec.label,
      onStatusChange: statusChanged,
      onDidChangeVisibility: (listener) =>
        panel.onDidChangeViewState(listener),
      isVisible: () => panel.visible,
    });
    this.#disposables.push(
      panel.onDidChangeViewState(() => {
        if (panel.active) {
          this.#onActivated(this);
          this.#host.focus();
        }
      }),
      panel.onDidDispose(() => {
        void this.#handleDisposed().catch((error) => {
          this.#logger.error(
            `Failed to close "${this.label}" completely`,
            error,
          );
        });
      }),
    );
  }

  get id(): string { return this.#spec.id; }
  get label(): string { return this.#spec.label; }
  get loopAlias(): string | undefined { return this.#spec.loopAlias; }
  get cwd(): string { return this.#spec.cwd; }
  get branch(): string | undefined { return this.#spec.branch; }
  get kind(): SessionKind { return this.#spec.kind; }
  get persistedKind(): SessionKind { return this.#spec.persistedKind ?? this.#spec.kind; }
  get transport(): SessionTransport { return this.#spec.transport; }
  get active(): boolean { return this.panel?.active ?? this.#active; }
  get status(): SessionStatus { return this.#status; }
  get sessionFile(): string | undefined { return this.#sessionFile; }
  get titleSource(): SessionTitleSource { return this.#titleSource; }
  get updatedAt(): number { return this.#updatedAt; }
  get rpcHost(): RpcSessionHost | undefined { return this.#rpcHost; }

  setActive(active: boolean): void {
    this.#active = active;
  }

  reveal(): void {
    if (this.#rpcHost) {
      this.#onActivated(this);
      this.#host.focus();
      return;
    }
    this.panel?.reveal(this.panel.viewColumn, false);
    this.#host.focus();
  }

  restart(): Promise<void> { return this.#host.restart(); }
  search(): void { this.#host.search(); }
  send(data: string): void { this.#host.send(data); }

  rename(label: string): void {
    const trimmed = label.trim();
    if (!trimmed) return;
    this.#spec = { ...this.#spec, label: trimmed };
    this.#titleSource = "manual";
    this.#updatedAt = Date.now();
    this.#host.setLabel(trimmed);
    if (this.panel) this.panel.title = this.#title();
    this.#onChanged(this);
  }

  dispose(): void {
    void this.shutdown().catch((error) => {
      this.#logger.error(`Failed to close "${this.label}" completely`, error);
    });
  }

  async shutdown(): Promise<void> {
    if (this.panel && !this.#disposed) {
      this.panel.dispose();
    }
    await this.#handleDisposed();
  }

  #title(): string {
    const suffix =
      this.#spec.kind === "readonly"
        ? " · think"
        : this.#spec.kind === "loop"
          ? " · loop"
          : "";
    const transport = this.#spec.transport === "rpc" ? "" : " · terminal";
    return `π ${this.#spec.label}${suffix}${transport}`;
  }

  #handleDisposed(): Promise<void> {
    if (!this.#disposePromise) {
      this.#disposed = true;
      this.#disposePromise = this.#disposeResources();
    }
    return this.#disposePromise;
  }

  async #disposeResources(): Promise<void> {
    await this.#host.dispose();
    for (const disposable of this.#disposables) disposable.dispose();
    this.#disposables = [];
    await this.#onDisposed(this);
  }
}
