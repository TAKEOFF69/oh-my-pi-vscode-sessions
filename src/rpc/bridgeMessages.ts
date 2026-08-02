const MAX_PROMPT_BYTES = 1024 * 1024;

export type RpcWebviewMessage =
  | { type: "ready" }
  | { type: "prompt" | "steer" | "follow_up"; message: string }
  | { type: "abort" }
  | {
      type: "extensionUiResponse";
      id: string;
      value?: string;
      confirmed?: boolean;
      cancelled?: boolean;
    }
  | {
      type: "openFile";
      path: string;
      line?: number;
      col?: number;
    }
  | { type: "openUrl"; uri: string }
  | { type: "showLogs" }
  | { type: "openDiagnosticTerminal" }
  | { type: "showSessions" }
  | { type: "openSettings" }
  | { type: "newSession" };

export function parseRpcWebviewMessage(
  raw: unknown,
): RpcWebviewMessage | null {
  if (!isRecord(raw) || typeof raw.type !== "string") {
    return null;
  }
  switch (raw.type) {
    case "ready":
    case "abort":
    case "showLogs":
    case "openDiagnosticTerminal":
    case "showSessions":
    case "openSettings":
    case "newSession":
      return { type: raw.type };
    case "prompt":
    case "steer":
    case "follow_up": {
      if (
        typeof raw.message !== "string" ||
        !raw.message.trim() ||
        Buffer.byteLength(raw.message, "utf8") > MAX_PROMPT_BYTES
      ) {
        return null;
      }
      return { type: raw.type, message: raw.message };
    }
    case "extensionUiResponse": {
      if (typeof raw.id !== "string" || !raw.id) {
        return null;
      }
      if (
        raw.value !== undefined &&
        typeof raw.value !== "string"
      ) {
        return null;
      }
      if (
        raw.confirmed !== undefined &&
        typeof raw.confirmed !== "boolean"
      ) {
        return null;
      }
      if (
        raw.cancelled !== undefined &&
        typeof raw.cancelled !== "boolean"
      ) {
        return null;
      }
      return {
        type: "extensionUiResponse",
        id: raw.id,
        value: raw.value,
        confirmed: raw.confirmed,
        cancelled: raw.cancelled,
      };
    }
    case "openFile": {
      if (typeof raw.path !== "string" || !raw.path) {
        return null;
      }
      return {
        type: "openFile",
        path: raw.path,
        line: optionalPositiveInt(raw.line),
        col: optionalPositiveInt(raw.col),
      };
    }
    case "openUrl":
      return typeof raw.uri === "string" && raw.uri
        ? { type: "openUrl", uri: raw.uri }
        : null;
    default:
      return null;
  }
}

function optionalPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1
    ? Math.floor(value)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
