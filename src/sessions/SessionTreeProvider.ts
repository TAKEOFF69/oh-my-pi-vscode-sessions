import * as nodePath from "node:path";

import * as vscode from "vscode";

import type { SessionPanel } from "./SessionPanel";

export class SessionTreeProvider
  implements vscode.TreeDataProvider<SessionPanel>, vscode.Disposable
{
  readonly #onDidChangeTreeData = new vscode.EventEmitter<
    SessionPanel | undefined
  >();
  readonly onDidChangeTreeData = this.#onDidChangeTreeData.event;
  #sessions: readonly SessionPanel[] = [];

  setSessions(sessions: readonly SessionPanel[]): void {
    this.#sessions = sessions;
    this.#onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(session: SessionPanel): vscode.TreeItem {
    const item = new vscode.TreeItem(
      session.label,
      vscode.TreeItemCollapsibleState.None,
    );
    const branch = session.branch ?? nodePath.basename(session.cwd);
    item.description =
      session.kind === "readonly"
        ? `${branch} · read-only`
        : session.kind === "loop"
          ? `${branch} · Loop controller`
          : branch;
    item.tooltip = new vscode.MarkdownString(
      [
        `**${escapeMarkdown(session.label)}**`,
        "",
        `- Mode: ${session.kind === "readonly" ? "read-only" : session.kind === "loop" ? "Loop controller" : "work"}`,
        `- Branch: ${escapeMarkdown(session.branch ?? "not detected")}`,
        `- Directory: \`${session.cwd.replace(/`/g, "\\`")}\``,
      ].join("\n"),
    );
    item.iconPath = new vscode.ThemeIcon(
      session.active ? "circle-filled" : "terminal",
    );
    item.contextValue = "ohMyPiSession";
    item.command = {
      command: "ohMyPiSessions.focusSession",
      title: "Focus OMP Session",
      arguments: [session],
    };
    return item;
  }

  getChildren(): SessionPanel[] {
    return [...this.#sessions];
  }

  dispose(): void {
    this.#onDidChangeTreeData.dispose();
  }
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
}
