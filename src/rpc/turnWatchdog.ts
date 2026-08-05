import type { RpcFrame } from "./RpcProcess";

export const FINAL_ANSWER_QUIET_MS = 90_000;

export function isTerminalAssistantMessageEnd(frame: RpcFrame): boolean {
  if (frame.type !== "message_end" || !isRecord(frame.message)) return false;
  return frame.message.role === "assistant" &&
    ["stop", "length", "error"].includes(String(frame.message.stopReason ?? ""));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
