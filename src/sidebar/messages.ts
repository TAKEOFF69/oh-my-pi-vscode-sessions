const MAX_PROMPT_BYTES = 1024 * 1024;

export type SidebarWebviewMessage =
  | { type: "ready" }
  | { type: "createSession"; prompt: string }
  | { type: "focusSession"; id: string }
  | { type: "showLogs" }
  | { type: "openSettings" };

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
      const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
      return prompt && Buffer.byteLength(prompt, "utf8") <= MAX_PROMPT_BYTES
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
