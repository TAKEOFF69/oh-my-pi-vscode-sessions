import * as vscode from "vscode";

import type { SessionKind, SessionStatus } from "../sessions/SessionPanel";
import { parseSidebarWebviewMessage } from "./messages";
import { buildSidebarHtml } from "./sidebarHtml";

export type SidebarSession = {
  id: string;
  label: string;
  cwd: string;
  branch?: string;
  kind: SessionKind;
  status: SessionStatus | "closed";
  active: boolean;
  live: boolean;
  updatedAt: number;
};

type SidebarCallbacks = {
  createSession: (prompt: string) => Promise<boolean>;
  focusSession: (id: string) => Promise<void> | void;
  showLogs: () => void;
};

export class SessionSidebarProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  readonly #extensionUri: vscode.Uri;
  readonly #callbacks: SidebarCallbacks;
  #view: vscode.WebviewView | undefined;
  #sessions: readonly SidebarSession[] = [];
  #creating = false;
  #pendingFocus: { clear: boolean } | undefined;
  #disposables: vscode.Disposable[] = [];

  constructor(extensionUri: vscode.Uri, callbacks: SidebarCallbacks) {
    this.#extensionUri = extensionUri;
    this.#callbacks = callbacks;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.#view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.#extensionUri, "dist"),
      ],
    };
    view.webview.html = buildSidebarHtml(view.webview, this.#extensionUri);
    this.#disposables.push(
      view.webview.onDidReceiveMessage((raw) => {
        void this.#handleMessage(raw);
      }),
      view.onDidDispose(() => {
        this.#view = undefined;
      }),
    );
  }

  setSessions(sessions: readonly SidebarSession[]): void {
    this.#sessions = sessions;
    void this.#postState();
  }

  focusComposer(clear = false): void {
    this.#pendingFocus = { clear };
    void vscode.commands.executeCommand("ohMyPiSessions.sessions.focus");
    void this.#post({ type: "focusComposer", clear });
  }

  dispose(): void {
    for (const disposable of this.#disposables) disposable.dispose();
    this.#disposables = [];
    this.#view = undefined;
  }

  async #handleMessage(raw: unknown): Promise<void> {
    const message = parseSidebarWebviewMessage(raw);
    if (!message) return;
    switch (message.type) {
      case "ready":
        await this.#postState();
        if (this.#pendingFocus) {
          const pending = this.#pendingFocus;
          this.#pendingFocus = undefined;
          await this.#post({ type: "focusComposer", clear: pending.clear });
        }
        return;
      case "showLogs":
        this.#callbacks.showLogs();
        return;
      case "openSettings":
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@ext:takeoff69.oh-my-pi-vscode-sessions",
        );
        return;
      case "focusSession":
        await this.#callbacks.focusSession(message.id);
        return;
      case "createSession":
        await this.#createSession(message.prompt);
        return;
    }
  }

  async #createSession(prompt: string): Promise<void> {
    if (this.#creating) return;
    this.#creating = true;
    await this.#postState();
    try {
      const created = await this.#callbacks.createSession(prompt);
      if (created) {
        await this.#post({ type: "sessionCreated" });
      } else {
        await this.#post({
          type: "sessionCreationFailed",
          draft: prompt,
          detail: "Session was not created. Your draft was restored.",
        });
      }
    } catch (error) {
      await this.#post({
        type: "sessionCreationFailed",
        draft: prompt,
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.#creating = false;
      await this.#postState();
    }
  }

  #postState(): Thenable<boolean> | Promise<boolean> {
    return this.#post({
      type: "state",
      creating: this.#creating,
      sessions: this.#sessions,
    });
  }

  #post(message: unknown): Thenable<boolean> | Promise<boolean> {
    return this.#view?.webview.postMessage(message) ?? Promise.resolve(false);
  }
}
