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
    const transport = session.transport === "rpc" ? "RPC" : "terminal";
    item.description =
      session.kind === "readonly"
        ? `${branch} · read-only ${transport} · ${session.status}`
        : session.kind === "loop"
          ? `${branch} · Loop ${transport} · ${session.status}`
          : `${branch} · ${transport} · ${session.status}`;
    item.tooltip = new vscode.MarkdownString(
      [
        `**${escapeMarkdown(session.label)}**`,
        "",
        `- Mode: ${session.kind === "readonly" ? "read-only" : session.kind === "loop" ? "Loop controller" : "work"}`,
        `- Surface: ${transport}`,
        `- Status: ${session.status}`,
        `- Branch: ${escapeMarkdown(session.branch ?? "not detected")}`,
        `- Directory: \`${session.cwd.replace(/`/g, "\\`")}\``,
      ].join("\n"),
    );
    item.iconPath = statusIcon(session.status, session.active);
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

function statusIcon(
  status: SessionPanel["status"],
  active: boolean,
): vscode.ThemeIcon {
  switch (status) {
    case "starting":
      return new vscode.ThemeIcon("sync~spin");
    case "idle":
      return new vscode.ThemeIcon(
        active ? "circle-filled" : "circle-outline",
        new vscode.ThemeColor("testing.iconPassed"),
      );
    case "finished":
      return new vscode.ThemeIcon(
        "pass-filled",
        new vscode.ThemeColor("testing.iconPassed"),
      );
    case "failed":
      return new vscode.ThemeIcon(
        "error",
        new vscode.ThemeColor("testing.iconFailed"),
      );
    case "running":
      return new vscode.ThemeIcon(
        active ? "circle-filled" : "terminal",
        new vscode.ThemeColor("testing.iconQueued"),
      );
  }
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
}
