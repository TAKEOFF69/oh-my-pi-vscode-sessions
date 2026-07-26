import * as vscode from "vscode";

export interface SessionLogger extends vscode.Disposable {
  info(message: string): void;
  error(message: string, error?: unknown): void;
  show(): void;
}

export class OutputSessionLogger implements SessionLogger {
  readonly #output: vscode.OutputChannel;

  constructor() {
    this.#output = vscode.window.createOutputChannel("OMP Sessions");
  }

  info(message: string): void {
    this.#output.appendLine(`${timestamp()} ${message}`);
  }

  error(message: string, error?: unknown): void {
    const detail =
      error === undefined
        ? ""
        : `: ${error instanceof Error ? error.stack ?? error.message : String(error)}`;
    this.#output.appendLine(`${timestamp()} ERROR ${message}${detail}`);
  }

  show(): void {
    this.#output.show(true);
  }

  dispose(): void {
    this.#output.dispose();
  }
}

function timestamp(): string {
  return new Date().toISOString();
}
