const MAX_PROMPT_BYTES = 1024 * 1024;

export type SidebarWebviewMessage =
  | { type: "ready" }
  | { type: "createSession"; prompt: string }
  | { type: "focusSession"; id: string }
  | { type: "showLogs" }
  | { type: "openSettings" };

export type SidebarFocusIntent = { sequence: number; clear: boolean };

export type SidebarSessionPayload = {
  id: string;
  label: string;
  kind: string;
  status: string;
  active: boolean;
  live: boolean;
  updatedAt: number;
};

export function toSidebarSessionPayload(
  session: SidebarSessionPayload,
): SidebarSessionPayload {
  return {
    id: session.id,
    label: session.label,
    kind: session.kind,
    status: session.status,
    active: session.active,
    live: session.live,
    updatedAt: session.updatedAt,
  };
}

export class SidebarFocusQueue {
  #sequence = 0;
  #pending: SidebarFocusIntent | undefined;

  begin(clear: boolean, viewReady: boolean): SidebarFocusIntent {
    const intent = { sequence: ++this.#sequence, clear };
    this.#pending = viewReady ? undefined : intent;
    return intent;
  }

  deliveryFailed(intent: SidebarFocusIntent): void {
    if (intent.sequence === this.#sequence) this.#pending = intent;
  }

  consumePending(): SidebarFocusIntent | undefined {
    const pending = this.#pending;
    this.#pending = undefined;
    return pending;
  }
}

export function parseSidebarWebviewMessage(
  raw: unknown,
): SidebarWebviewMessage | null {
  if (!isRecord(raw) || typeof raw.type !== "string") return null;
  switch (raw.type) {
    case "ready":
    case "showLogs":
    case "openSettings":
      return { type: raw.type };
    case "createSession": {
      const prompt = typeof raw.prompt === "string" ? raw.prompt : "";
      return prompt.trim() && Buffer.byteLength(prompt, "utf8") <= MAX_PROMPT_BYTES
        ? { type: "createSession", prompt }
        : null;
    }
    case "focusSession":
      return typeof raw.id === "string" && raw.id.length > 0 && raw.id.length <= 128
        ? { type: "focusSession", id: raw.id }
        : null;
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
