import * as vscode from "vscode";
import { randomBytes } from "node:crypto";

import type { PromptDraft, PromptImage } from "../promptImages";
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
import { PendingDraftStore } from "./PendingDraftStore";
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
  createSession: (draft: PromptDraft, token: string) => Promise<boolean>;
  focusSession: (id: string) => Promise<void> | void;
  closeSession: (id: string) => Promise<void> | void;
  restartSession: (id: string) => Promise<void> | void;
  removeSession: (id: string) => Promise<void> | void;
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
  #homeImages: PromptImage[] = [];
  readonly #pendingDrafts: PendingDraftStore;
  #draftToken = randomBytes(16).toString("hex");
  #pendingDelivery = false;
  #runtimeNotice: string | undefined;
  #draftTimer: NodeJS.Timeout | undefined;
  #surfaceToken = "";
  readonly #router = new SelectedSessionRouter<vscode.Webview, RpcSessionHost>();
  readonly #focusQueue = new SidebarFocusQueue();
  #profile: SidebarProfile = {
    accessLabel: "Custom access",
    modelLabel: "Opus 5 · Extra High",
    modelDetail: "Opus 5 Extra High driver; GPT-5.6 Sol Extra High advisor configured",
  };
  #disposables: vscode.Disposable[] = [];
  #viewDisposables: vscode.Disposable[] = [];

  constructor(
    extensionUri: vscode.Uri,
    callbacks: SidebarCallbacks,
    workspaceState: vscode.Memento,
  ) {
    this.#extensionUri = extensionUri;
    this.#callbacks = callbacks;
    this.#pendingDrafts = new PendingDraftStore(workspaceState);
    const pending = this.#pendingDrafts.load();
    if (pending) {
      this.#draftToken = pending.token;
      this.#homeDraft = pending.message;
      this.#homeImages = [...pending.images];
    }
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    for (const disposable of this.#viewDisposables) disposable.dispose();
    this.#viewDisposables = [];
    this.#view = view;
    this.#ready = false;
    this.#viewDisposables.push(
      view.webview.onDidReceiveMessage((raw) => {
        void this.#handleMessage(raw);
      }),
      view.onDidDispose(() => {
        if (this.#view !== view) return;
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
    void focusSidebar();
    if (same && this.#ready) host.focus();
  }

  showHome(clearDraft = false): void {
    if (clearDraft) {
      const staleToken = this.#draftToken;
      this.#homeDraft = "";
      this.#homeImages = [];
      this.#pendingDelivery = false;
      this.#draftToken = randomBytes(16).toString("hex");
      void this.#pendingDrafts.clear(staleToken);
    }
    const changed = Boolean(this.#router.selected);
    this.#detachConversation();
    this.#callbacks.clearActiveSession();
    if (changed) {
      this.#ready = false;
      this.#renderSurface();
    }
    void focusSidebar();
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
    for (const disposable of this.#viewDisposables) disposable.dispose();
    this.#viewDisposables = [];
    for (const disposable of this.#disposables) disposable.dispose();
    this.#disposables = [];
    this.#view = undefined;
    this.#ready = false;
    if (this.#draftTimer) clearTimeout(this.#draftTimer);
  }

  async flush(): Promise<void> {
    if (this.#draftTimer) {
      clearTimeout(this.#draftTimer);
      this.#draftTimer = undefined;
    }
    await this.#persistDraftNow();
    await this.#pendingDrafts.flush();
  }

  setRuntimeNotice(detail: string | undefined): void {
    if (this.#runtimeNotice === detail) return;
    this.#runtimeNotice = detail;
    if (detail && this.#router.selected) {
      this.#router.selected.host.showHostNotice(detail);
    }
    void this.#postHomeState();
  }

  async acknowledgeDraft(token: string, accepted: boolean): Promise<void> {
    if (token !== this.#draftToken) return;
    this.#pendingDelivery = false;
    if (accepted) {
      await this.#pendingDrafts.clear(token);
      this.#homeDraft = "";
      this.#homeImages = [];
      this.#draftToken = randomBytes(16).toString("hex");
    }
    await this.#postHomeState();
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
      if (isMessageType(raw, "restartCurrentSession")) {
        await this.#callbacks.restartSession(this.#router.selected.id);
        return;
      }
      if (isMessageType(raw, "closeCurrentSession")) {
        await this.#callbacks.closeSession(this.#router.selected.id);
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
        await this.#post({
          type: "setDraft",
          draft: this.#homeDraft,
          images: this.#homeImages,
        });
        {
          const pending = this.#focusQueue.consumePending();
          if (!pending) return;
          await this.#post({ type: "focusComposer", clear: pending.clear });
        }
        return;
      case "draftChanged":
        this.#homeDraft = message.draft;
        this.#scheduleDraftPersistence();
        return;
      case "attachmentsChanged":
        this.#homeImages = message.images;
        this.#scheduleDraftPersistence();
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
      case "reloadWindow":
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
        return;
      case "closeSession":
        await this.#callbacks.closeSession(message.id);
        return;
      case "restartSession":
        await this.#callbacks.restartSession(message.id);
        return;
      case "removeSession":
        await this.#callbacks.removeSession(message.id);
        return;
      case "createSession":
        await this.#createSession({
          message: message.prompt,
          images: message.images,
        });
        return;
    }
  }

  async #createSession(draft: PromptDraft): Promise<void> {
    if (this.#creating) return;
    this.#creating = true;
    this.#homeDraft = draft.message;
    this.#homeImages = draft.images;
    const token = this.#draftToken;
    await this.#pendingDrafts.save({
      token,
      message: draft.message,
      images: draft.images,
      updatedAt: Date.now(),
    });
    this.#pendingDelivery = true;
    await this.#postHomeState();
    try {
      const created = await this.#callbacks.createSession(draft, token);
      if (!created) {
        this.#pendingDelivery = false;
        await this.#post({
          type: "sessionCreationFailed",
          draft: draft.message,
          images: draft.images,
          detail: "Session was not created. Your draft was restored.",
        });
      }
    } catch (error) {
      this.#pendingDelivery = false;
      await this.#post({
        type: "sessionCreationFailed",
        draft: draft.message,
        images: draft.images,
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.#creating = false;
      await this.#postHomeState();
    }
  }

  #scheduleDraftPersistence(): void {
    if (this.#draftTimer) clearTimeout(this.#draftTimer);
    this.#draftTimer = setTimeout(() => {
      this.#draftTimer = undefined;
      void this.#persistDraftNow();
    }, 250);
  }

  async #persistDraftNow(): Promise<void> {
    if (!this.#homeDraft.trim() && this.#homeImages.length === 0) {
      await this.#pendingDrafts.clear(this.#draftToken);
      return;
    }
    await this.#pendingDrafts.save({
      token: this.#draftToken,
      message: this.#homeDraft,
      images: this.#homeImages,
      updatedAt: Date.now(),
    });
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
      creating: this.#creating || this.#pendingDelivery,
      profile: this.#profile,
      runtimeNotice: this.#runtimeNotice,
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

async function focusSidebar(): Promise<void> {
  try {
    await vscode.commands.executeCommand(
      "workbench.view.extension.oh-my-pi-sessions",
    );
  } catch {
    // Presentation routing must not fail if VS Code is already tearing down.
  }
}
