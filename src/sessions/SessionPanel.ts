import * as vscode from "vscode";

import { TerminalSessionHost } from "../terminal/TerminalSessionHost";

export type SessionKind = "work" | "readonly" | "loop";

export type SessionSpec = {
  id: string;
  label: string;
  cwd: string;
  branch?: string;
  kind: SessionKind;
  executable: string;
  args: readonly string[];
};

export class SessionPanel implements vscode.Disposable {
  static readonly viewType = "ohMyPiSessions.session";

  readonly panel: vscode.WebviewPanel;
  readonly #host: TerminalSessionHost;
  readonly #onDisposed: (session: SessionPanel) => void;
  readonly #onActivated: (session: SessionPanel) => void;
  #disposed = false;
  #spec: SessionSpec;
  #disposables: vscode.Disposable[] = [];

  constructor(
    extensionUri: vscode.Uri,
    spec: SessionSpec,
    onDisposed: (session: SessionPanel) => void,
    onActivated: (session: SessionPanel) => void,
  ) {
    this.#spec = spec;
    this.#onDisposed = onDisposed;
    this.#onActivated = onActivated;
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

    this.#host = new TerminalSessionHost({
      extensionUri,
      webview: this.panel.webview,
      cwd: spec.cwd,
      executable: spec.executable,
      args: spec.args,
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
      this.panel.onDidDispose(() => this.#handleDisposed()),
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

  get active(): boolean {
    return this.panel.active;
  }

  reveal(): void {
    this.panel.reveal(this.panel.viewColumn, false);
    this.#host.focus();
  }

  restart(): void {
    this.#host.restart();
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
    this.panel.title = this.#title();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.panel.dispose();
  }

  #title(): string {
    const suffix =
      this.#spec.kind === "readonly"
        ? " · think"
        : this.#spec.kind === "loop"
          ? " · loop"
          : "";
    return `π ${this.#spec.label}${suffix}`;
  }

  #handleDisposed(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#host.dispose();
    for (const disposable of this.#disposables) {
      disposable.dispose();
    }
    this.#disposables = [];
    this.#onDisposed(this);
  }
}
