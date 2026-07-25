import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";

import * as vscode from "vscode";

import { getTerminalFont } from "../config";
import { parseTerminalMessage } from "../messages";
import { PtySession } from "./ptySession";
import { buildTerminalHtml } from "./terminalHtml";

export type TerminalSessionHostOptions = {
  extensionUri: vscode.Uri;
  webview: vscode.Webview;
  cwd: string;
  executable: string;
  args: readonly string[];
  onDidChangeVisibility: (
    listener: () => void,
  ) => vscode.Disposable;
  isVisible: () => boolean;
};

export class TerminalSessionHost implements vscode.Disposable {
  readonly #extensionUri: vscode.Uri;
  readonly #webview: vscode.Webview;
  readonly #cwd: string;
  readonly #executable: string;
  readonly #args: readonly string[];
  readonly #pty = new PtySession();
  #cols = 80;
  #rows = 24;
  #spawned = false;
  #exited = false;
  #disposed = false;
  #ready = false;
  #pendingInput: string[] = [];
  #disposables: vscode.Disposable[] = [];

  constructor(options: TerminalSessionHostOptions) {
    this.#extensionUri = options.extensionUri;
    this.#webview = options.webview;
    this.#cwd = options.cwd;
    this.#executable = options.executable;
    this.#args = options.args;

    this.#webview.options = { enableScripts: true };
    this.#setWebviewHtml();

    this.#disposables.push(
      this.#webview.onDidReceiveMessage((raw) => this.#handleMessage(raw)),
      options.onDidChangeVisibility(() => {
        if (options.isVisible()) {
          void this.#webview.postMessage({ type: "focus" });
        }
      }),
      vscode.window.onDidChangeActiveColorTheme(() => this.syncAppearance()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration("terminal.integrated.fontFamily") ||
          event.affectsConfiguration("terminal.integrated.fontSize")
        ) {
          this.syncAppearance();
        }
      }),
    );
  }

  send(data: string): void {
    if (!data || this.#disposed) {
      return;
    }
    if (this.#exited) {
      this.restart();
    }
    if (!this.#ready) {
      this.#pendingInput.push(data);
      return;
    }
    this.#ensurePty();
    this.#writeInput(data);
  }

  restart(): void {
    if (this.#disposed) {
      return;
    }
    this.#pty.dispose();
    this.#spawned = false;
    this.#exited = false;
    void this.#webview.postMessage({ type: "clear" });
    if (this.#ready) {
      this.#ensurePty();
    }
  }

  search(): void {
    void this.#webview.postMessage({ type: "search" });
  }

  focus(): void {
    void this.#webview.postMessage({ type: "focus" });
  }

  syncAppearance(): void {
    if (this.#disposed) {
      return;
    }
    void this.#webview.postMessage({ type: "theme" });
    void this.#webview.postMessage({
      type: "font",
      ...getTerminalFont(),
    });
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#pty.dispose();
    for (const disposable of this.#disposables) {
      disposable.dispose();
    }
    this.#disposables = [];
    this.#pendingInput = [];
  }

  #handleMessage(raw: unknown): void {
    const message = parseTerminalMessage(raw);
    if (!message || this.#disposed) {
      return;
    }

    switch (message.type) {
      case "ready":
        this.#ready = true;
        this.#cols = message.cols ?? this.#cols;
        this.#rows = message.rows ?? this.#rows;
        this.#ensurePty();
        this.#flushPendingInput();
        break;
      case "resize":
        this.#cols = message.cols ?? this.#cols;
        this.#rows = message.rows ?? this.#rows;
        this.#pty.resize(this.#cols, this.#rows);
        break;
      case "input":
        if (this.#exited) {
          this.restart();
        }
        this.#ensurePty();
        this.#writeInput(message.data ?? "");
        break;
      case "openUrl":
        if (message.uri) {
          void vscode.env.openExternal(vscode.Uri.parse(message.uri));
        }
        break;
      case "openFile":
        if (message.path) {
          this.#openFile(message.path, message.line, message.col);
        }
        break;
    }
  }

  #ensurePty(): void {
    if (this.#spawned && !this.#exited) {
      this.#pty.resize(this.#cols, this.#rows);
      return;
    }

    this.#spawned = true;
    this.#exited = false;

    try {
      this.#pty.spawn({
        executable: this.#executable,
        args: this.#args,
        cwd: this.#cwd,
        cols: this.#cols,
        rows: this.#rows,
        onData: (data) => {
          void this.#webview.postMessage({ type: "data", data });
        },
        onExit: (code) => {
          this.#exited = true;
          this.#spawned = false;
          void this.#webview.postMessage({ type: "exit", code });
        },
      });
    } catch (error) {
      this.#spawned = false;
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `OMP Sessions: failed to start omp — ${message}`,
      );
      void this.#webview.postMessage({
        type: "data",
        data: `\r\n\x1b[31mFailed to start omp: ${message}\x1b[0m\r\n`,
      });
    }
  }

  #flushPendingInput(): void {
    if (!this.#spawned || this.#exited) {
      return;
    }
    const pending = this.#pendingInput;
    this.#pendingInput = [];
    for (const data of pending) {
      this.#writeInput(data);
    }
  }

  #writeInput(data: string): void {
    this.#pty.write(data);
    if (data === "\x03") {
      setTimeout(() => this.#pty.write("\r"), 20);
    }
  }

  #setWebviewHtml(): void {
    const result = buildTerminalHtml(
      this.#extensionUri.fsPath,
      getTerminalFont(),
    );
    this.#webview.html = result.html;
    if (!result.ok) {
      void vscode.window.showErrorMessage(`OMP Sessions: ${result.error}`);
    }
  }

  #openFile(filePath: string, line?: number, col?: number): void {
    const resolved = this.#resolveFilePath(filePath);
    if (!resolved) {
      void vscode.window.showWarningMessage(
        `OMP Sessions: cannot find ${filePath} from ${this.#cwd}`,
      );
      return;
    }

    void vscode.workspace.openTextDocument(vscode.Uri.file(resolved)).then(
      (document) => {
        void vscode.window.showTextDocument(document).then((editor) => {
          if (line === undefined || line < 1) {
            return;
          }
          const targetLine = Math.min(line - 1, document.lineCount - 1);
          const targetColumn = col !== undefined && col >= 1 ? col - 1 : 0;
          const position = new vscode.Position(targetLine, targetColumn);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter,
          );
        });
      },
      (error) => {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(
          `OMP Sessions: cannot open ${filePath} — ${message}`,
        );
      },
    );
  }

  #resolveFilePath(filePath: string): string | undefined {
    const expanded = filePath.startsWith("~")
      ? nodePath.join(os.homedir(), filePath.slice(1))
      : filePath;

    if (nodePath.isAbsolute(expanded) && this.#isFile(expanded)) {
      return expanded;
    }

    const sessionCandidate = nodePath.resolve(this.#cwd, expanded);
    if (this.#isFile(sessionCandidate)) {
      return sessionCandidate;
    }

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const workspaceCandidate = nodePath.resolve(
        folder.uri.fsPath,
        expanded,
      );
      if (this.#isFile(workspaceCandidate)) {
        return workspaceCandidate;
      }
    }

    return undefined;
  }

  #isFile(fsPath: string): boolean {
    try {
      return fs.existsSync(fsPath) && fs.statSync(fsPath).isFile();
    } catch {
      return false;
    }
  }
}
