import * as nodePath from "node:path";

import * as vscode from "vscode";

import { SessionManager } from "./sessions/SessionManager";
import type { SessionPanel } from "./sessions/SessionPanel";

export function activate(context: vscode.ExtensionContext): void {
  const manager = new SessionManager(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider(
      "ohMyPiSessions.sessions",
      manager.tree,
    ),
    vscode.commands.registerCommand("ohMyPiSessions.open", () =>
      manager.openOrCreate(),
    ),
    vscode.commands.registerCommand("ohMyPiSessions.newSession", () =>
      manager.newSession("work"),
    ),
    vscode.commands.registerCommand(
      "ohMyPiSessions.newReadOnlySession",
      () => manager.newSession("readonly"),
    ),
    vscode.commands.registerCommand(
      "ohMyPiSessions.newLoopSession",
      () => manager.newSession("loop"),
    ),
    vscode.commands.registerCommand(
      "ohMyPiSessions.focusSession",
      (session?: SessionPanel) => manager.focus(session),
    ),
    vscode.commands.registerCommand(
      "ohMyPiSessions.restartSession",
      (session?: SessionPanel) => manager.restart(session),
    ),
    vscode.commands.registerCommand(
      "ohMyPiSessions.searchSession",
      (session?: SessionPanel) => manager.search(session),
    ),
    vscode.commands.registerCommand(
      "ohMyPiSessions.renameSession",
      (session?: SessionPanel) => manager.rename(session),
    ),
    vscode.commands.registerCommand(
      "ohMyPiSessions.closeSession",
      (session?: SessionPanel) => manager.close(session),
    ),
    vscode.commands.registerCommand("ohMyPiSessions.closeAll", () =>
      manager.closeAll(),
    ),
    vscode.commands.registerCommand(
      "ohMyPiSessions.sendSelection",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          return;
        }
        const selection = editor.selection;
        const text = selection.isEmpty
          ? editor.document.lineAt(selection.active.line).text
          : editor.document.getText(selection);
        if (!text) {
          return;
        }
        const target = await manager.resolveTarget();
        target?.send(text);
      },
    ),
    vscode.commands.registerCommand("ohMyPiSessions.sendLines", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const target = await manager.resolveTarget();
      if (!target) {
        return;
      }

      const { document, selection } = editor;
      let start = selection.start.line;
      let end = selection.end.line;
      if (selection.end.character === 0 && end > start) {
        end -= 1;
      }
      const lastLine = document.lineCount - 1;
      start = Math.max(0, Math.min(start, lastLine));
      end = Math.max(0, Math.min(end, lastLine));

      const startNumber = start + 1;
      const endNumber = end + 1;
      const filePath = pathForSession(document.uri.fsPath, target.cwd);
      const reference =
        startNumber === endNumber
          ? `${filePath}:${startNumber}`
          : `${filePath}:${startNumber}-${endNumber}`;
      target.send(`${reference}\n`);
    }),
    vscode.commands.registerCommand("ohMyPiSessions.sendFile", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const target = await manager.resolveTarget();
      if (!target) {
        return;
      }
      target.send(`${pathForSession(editor.document.uri.fsPath, target.cwd)}\n`);
    }),
    manager,
  );

  if (
    vscode.workspace
      .getConfiguration("ohMyPiSessions")
      .get<boolean>("autoStart", false)
  ) {
    void manager.newSession("work");
  }
}

export function deactivate(): void {}

function pathForSession(filePath: string, cwd: string): string {
  const relative = nodePath.relative(cwd, filePath);
  if (
    !relative ||
    relative.startsWith(`..${nodePath.sep}`) ||
    nodePath.isAbsolute(relative)
  ) {
    return filePath;
  }
  return relative;
}
