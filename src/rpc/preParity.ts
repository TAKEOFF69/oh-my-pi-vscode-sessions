import type { RpcFrame } from "./RpcProcess";

export type PreParityDisposition = "buffer" | "reject-ui";

export function classifyPreParityFrame(
  frame: RpcFrame,
): PreParityDisposition {
  if (frame.type !== "extension_ui_request") {
    return "buffer";
  }
  return frame.method === "setStatus" || frame.method === "setWidget"
    ? "buffer"
    : "reject-ui";
}
