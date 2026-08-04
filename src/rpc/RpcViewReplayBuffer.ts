export type ReplayableRpcFrame = {
  type: string;
  id?: unknown;
  method?: unknown;
  targetId?: unknown;
};

export class RpcViewReplayBuffer<TFrame extends ReplayableRpcFrame> {
  #revision: number | undefined;
  #frames: TFrame[] = [];
  readonly #pendingRequests = new Map<string, TFrame>();

  begin(revision: number): void {
    this.#revision = revision;
    this.#frames = [];
  }

  capture(revision: number, frame: TFrame): boolean {
    if (this.#revision !== revision) return false;
    this.#frames.push(frame);
    return true;
  }

  resetAtHistoryBoundary(revision: number): boolean {
    if (this.#revision !== revision) return false;
    this.#frames = [];
    return true;
  }

  drain(revision: number): TFrame[] {
    if (this.#revision !== revision) return [];
    return this.#frames.splice(0);
  }

  finish(revision: number): boolean {
    if (this.#revision !== revision) return false;
    this.cancel();
    return true;
  }

  cancel(): void {
    this.#revision = undefined;
    this.#frames = [];
  }

  observeUiRequest(frame: TFrame): void {
    if (frame.type !== "extension_ui_request") {
      return;
    }
    if (frame.method === "cancel") {
      const targetId = typeof frame.targetId === "string" ? frame.targetId : "";
      if (targetId) this.#pendingRequests.delete(targetId);
      return;
    }
    if (!isInteractive(frame.method)) return;
    const id = typeof frame.id === "string" ? frame.id : "";
    if (id) this.#pendingRequests.set(id, frame);
  }

  resolveUiRequest(id: string): void {
    this.#pendingRequests.delete(id);
  }

  pendingUiRequests(): TFrame[] {
    return [...this.#pendingRequests.values()];
  }

  clearPendingUiRequests(): void {
    this.#pendingRequests.clear();
  }
}

function isInteractive(method: unknown): boolean {
  return (
    typeof method === "string" &&
    !["open_url", "setTitle", "set_editor_text", "setEditorText"].includes(
      method,
    )
  );
}
