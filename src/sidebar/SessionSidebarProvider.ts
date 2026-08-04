import * as vscode from "vscode";
import { randomBytes } from "node:crypto";

import type { RpcSessionHost } from "../rpc/RpcSessionHost";
import { buildRpcHtml } from "../rpc/rpcHtml";
import type { SessionKind, SessionStatus } from "../sessions/SessionPanel";
import {
  parseSidebarWebviewMessage,
  SidebarFocusQueue,
  toSidebarSessionPayload,
} from "./messages";
import { buildSidebarHtml } from "./sidebarHtml";
import { SelectedSessionRouter } from "./SelectedSessionRouter";
import { messageMatchesSurface, tagSurfaceMessage } from "./surfaceRouting";

export type SidebarSession = {
  id: string;
  label: string;
  kind: SessionKind;
  status: SessionStatus | "closed";
  active: boolean;
  live: boolean;
  updatedAt: number;
};

export type SidebarProfile = {
  accessLabel: string;
  modelLabel: string;
  modelDetail: string;
};

type SidebarCallbacks = {
  createSession: (prompt: string) => Promise<boolean>;
  focusSession: (id: string) => Promise<void> | void;
  clearActiveSession: () => void;
  showLogs: () => void;
};

export class SessionSidebarProvider
  implements vscode.WebviewViewProvider, vscode.Disposable
{
  readonly #extensionUri: vscode.Uri;
  readonly #callbacks: SidebarCallbacks;
  #view: vscode.WebviewView | undefined;
  #ready = false;
  #sessions: readonly SidebarSession[] = [];
  #creating = false;
  #homeDraft = "";
  #surfaceToken = "";
  readonly #router = new SelectedSessionRouter<vscode.Webview, RpcSessionHost>();
  readonly #focusQueue = new SidebarFocusQueue();
  #profile: SidebarProfile = {
    accessLabel: "Full access",
    modelLabel: "Opus 5 · Extra High",
    modelDetail: "Opus 5 Extra High driver; GPT-5.6 Sol Extra High advisor configured",
  };
  #disposables: vscode.Disposable[] = [];

  constructor(extensionUri: vscode.Uri, callbacks: SidebarCallbacks) {
    this.#extensionUri = extensionUri;
    this.#callbacks = callbacks;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.#view = view;
    this.#ready = false;
    this.#disposables.push(
      view.webview.onDidReceiveMessage((raw) => {
        void this.#handleMessage(raw);
      }),
      view.onDidDispose(() => {
        this.#router.selected?.host.detachWebview(view.webview);
        this.#view = undefined;
        this.#ready = false;
      }),
    );
    this.#renderSurface();
  }

  setSessions(sessions: readonly SidebarSession[]): void {
    this.#sessions = sessions;
    void this.#postHomeState();
  }

  setProfile(profile: SidebarProfile): void {
    this.#profile = profile;
    void this.#postHomeState();
  }

  showSession(id: string, host: RpcSessionHost): void {
    const same = this.#router.isSelected(id, host);
    if (!same) {
      this.#detachConversation();
      this.#router.select(id, host);
      this.#ready = false;
      this.#renderSurface();
    }
    void vscode.commands.executeCommand("ohMyPiSessions.sessions.focus");
    if (same && this.#ready) host.focus();
  }

  showHome(clearDraft = false): void {
    if (clearDraft) this.#homeDraft = "";
    const changed = Boolean(this.#router.selected);
    this.#detachConversation();
    this.#callbacks.clearActiveSession();
    if (changed) {
      this.#ready = false;
      this.#renderSurface();
    }
    void vscode.commands.executeCommand("ohMyPiSessions.sessions.focus");
    const intent = this.#focusQueue.begin(clearDraft, this.#ready);
    if (this.#view && this.#ready) {
      void this.#post({ type: "focusComposer", clear: clearDraft }).then(
        (delivered) => {
          if (!delivered) this.#focusQueue.deliveryFailed(intent);
        },
      );
    }
  }

  focusComposer(clear = false): void {
    this.showHome(clear);
  }

  dispose(): void {
    this.#detachConversation();
    for (const disposable of this.#disposables) disposable.dispose();
    this.#disposables = [];
    this.#view = undefined;
    this.#ready = false;
  }

  async #handleMessage(raw: unknown): Promise<void> {
    if (!messageMatchesSurface(raw, this.#surfaceToken)) return;
    if (this.#router.selected) {
      if (isMessageType(raw, "showSessions")) {
        this.showHome(false);
        return;
      }
      if (isMessageType(raw, "newSession")) {
        this.showHome(true);
        return;
      }
      await this.#router.dispatch(raw);
      return;
    }

    const message = parseSidebarWebviewMessage(raw);
    if (!message) return;
    switch (message.type) {
      case "ready":
        this.#ready = true;
        await this.#postHomeState();
        await this.#post({ type: "setDraft", draft: this.#homeDraft });
        {
          const pending = this.#focusQueue.consumePending();
          if (!pending) return;
          await this.#post({ type: "focusComposer", clear: pending.clear });
        }
        return;
      case "draftChanged":
        this.#homeDraft = message.draft;
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
    this.#homeDraft = prompt;
    await this.#postHomeState();
    try {
      const created = await this.#callbacks.createSession(prompt);
      if (created) {
        this.#homeDraft = "";
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
      await this.#postHomeState();
    }
  }

  #renderSurface(): void {
    const view = this.#view;
    if (!view) return;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.#extensionUri],
    };
    this.#surfaceToken = randomBytes(16).toString("hex");
    if (this.#router.selected) {
      view.webview.html = buildRpcHtml(
        view.webview,
        this.#extensionUri,
        this.#surfaceToken,
      );
      this.#router.attach(view.webview, this.#surfaceToken);
    } else {
      view.webview.html = buildSidebarHtml(
        view.webview,
        this.#extensionUri,
        this.#surfaceToken,
      );
    }
  }

  #detachConversation(): void {
    this.#router.clear(this.#view?.webview);
  }

  #postHomeState(): Thenable<boolean> | Promise<boolean> {
    if (this.#router.selected || !this.#ready) return Promise.resolve(false);
    return this.#post({
      type: "state",
      creating: this.#creating,
      profile: this.#profile,
      sessions: this.#sessions.map(toSidebarSessionPayload),
    });
  }

  #post(message: unknown): Thenable<boolean> | Promise<boolean> {
    return this.#view?.webview.postMessage(
      tagSurfaceMessage(message, this.#surfaceToken),
    ) ?? Promise.resolve(false);
  }
}

function isMessageType(raw: unknown, type: string): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    (raw as { type?: unknown }).type === type
  );
}
