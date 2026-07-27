import * as vscode from "vscode";

import type { SessionLogger } from "../logging";
import type { RpcParityProfile } from "../rpc/parity";
import { RpcSessionHost } from "../rpc/RpcSessionHost";
import { TerminalSessionHost } from "../terminal/TerminalSessionHost";
import type { SessionHost } from "./SessionHost";

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
  cwd: string;
  branch?: string;
  kind: SessionKind;
  transport: SessionTransport;
  executable: string;
  args: readonly string[];
  initialPrompt?: string;
  parity?: RpcParityProfile;
};

export class SessionPanel implements vscode.Disposable {
  static readonly viewType = "ohMyPiSessions.session";

  readonly panel: vscode.WebviewPanel;
  readonly #host: SessionHost;
  readonly #onDisposed: (
    session: SessionPanel,
  ) => void | Promise<void>;
  readonly #onActivated: (session: SessionPanel) => void;
  readonly #onChanged: (session: SessionPanel) => void;
  readonly #logger: SessionLogger;
  #disposed = false;
  #disposePromise: Promise<void> | undefined;
  #status: SessionStatus = "starting";
  #spec: SessionSpec;
  #disposables: vscode.Disposable[] = [];

  constructor(
    extensionUri: vscode.Uri,
    spec: SessionSpec,
    onDisposed: (session: SessionPanel) => void | Promise<void>,
    onActivated: (session: SessionPanel) => void,
    onChanged: (session: SessionPanel) => void,
    logger: SessionLogger,
  ) {
    this.#spec = spec;
    this.#onDisposed = onDisposed;
    this.#onActivated = onActivated;
    this.#onChanged = onChanged;
    this.#logger = logger;
    this.panel = vscode.window.createWebviewPanel(
      SessionPanel.viewType,
      this.#title(),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    this.panel.iconPath = vscode.Uri.joinPath(
      extensionUri,
      "media",
      "activity-icon.svg",
    );

    const statusChanged = (status: SessionStatus) => {
      this.#status = status;
      this.#onChanged(this);
    };
    this.#host =
      spec.transport === "rpc"
        ? new RpcSessionHost({
            extensionUri,
            webview: this.panel.webview,
            cwd: spec.cwd,
            branch: spec.branch,
            kind: spec.kind,
            executable: spec.executable,
            args: spec.args,
            initialPrompt: spec.initialPrompt,
            parity: spec.parity,
            logger,
            label: spec.label,
            onStatusChange: statusChanged,
            onTitleChange: (title) => {
              this.#spec = { ...this.#spec, label: title };
              this.panel.title = this.#title();
              this.#onChanged(this);
            },
          })
        : new TerminalSessionHost({
            extensionUri,
            webview: this.panel.webview,
            cwd: spec.cwd,
            executable: spec.executable,
            args: spec.args,
            logger,
            label: spec.label,
            onStatusChange: statusChanged,
            onDidChangeVisibility: (listener) =>
              this.panel.onDidChangeViewState(listener),
            isVisible: () => this.panel.visible,
          });

    this.#disposables.push(
      this.panel.onDidChangeViewState(() => {
        if (this.panel.active) {
          this.#onActivated(this);
          this.#host.focus();
        }
      }),
      this.panel.onDidDispose(() => {
        void this.#handleDisposed().catch((error) => {
          this.#logger.error(
            `Failed to close "${this.label}" completely`,
            error,
          );
        });
      }),
    );

    this.#onActivated(this);
  }

  get id(): string {
    return this.#spec.id;
  }

  get label(): string {
    return this.#spec.label;
  }

  get cwd(): string {
    return this.#spec.cwd;
  }

  get branch(): string | undefined {
    return this.#spec.branch;
  }

  get kind(): SessionKind {
    return this.#spec.kind;
  }

  get transport(): SessionTransport {
    return this.#spec.transport;
  }

  get active(): boolean {
    return this.panel.active;
  }

  get status(): SessionStatus {
    return this.#status;
  }

  reveal(): void {
    this.panel.reveal(this.panel.viewColumn, false);
    this.#host.focus();
  }

  restart(): Promise<void> {
    return this.#host.restart();
  }

  search(): void {
    this.#host.search();
  }

  send(data: string): void {
    this.#host.send(data);
  }

  rename(label: string): void {
    const trimmed = label.trim();
    if (!trimmed) {
      return;
    }
    this.#spec = { ...this.#spec, label: trimmed };
    this.#host.setLabel(trimmed);
    this.panel.title = this.#title();
  }

  dispose(): void {
    void this.shutdown().catch((error) => {
      this.#logger.error(
        `Failed to close "${this.label}" completely`,
        error,
      );
    });
  }

  async shutdown(): Promise<void> {
    if (!this.#disposed) {
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
    for (const disposable of this.#disposables) {
      disposable.dispose();
    }
    this.#disposables = [];
    await this.#onDisposed(this);
  }
}
