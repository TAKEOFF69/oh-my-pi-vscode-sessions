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

export function isNativeToolApprovalRequest(frame: RpcFrame): boolean {
  if (frame.type !== "extension_ui_request") return false;
  const method = typeof frame.method === "string" ? frame.method : "";
  const title = typeof frame.title === "string" ? frame.title.trim() : "";
  return (
    (method === "select" || method === "confirm") &&
    /^allow tool(?:\s*:|\b)/i.test(title)
  );
}

export function shouldFailClosedToolApproval(
  parityProfileName: string | undefined,
  frame: RpcFrame,
): boolean {
  return (
    parityProfileName?.startsWith("dzialki-") === true &&
    isNativeToolApprovalRequest(frame)
  );
}

export const TOOL_APPROVAL_DRIFT_DETAIL =
  "Canonical no-popup access drifted: OMP requested native tool approval after parity.";

export function enforceToolApprovalTripwire(
  parityProfileName: string | undefined,
  frame: RpcFrame,
  actions: {
    cancel: (frame: RpcFrame) => void;
    block: (detail: string) => void;
  },
): boolean {
  if (!shouldFailClosedToolApproval(parityProfileName, frame)) return false;
  actions.cancel(frame);
  actions.block(TOOL_APPROVAL_DRIFT_DETAIL);
  return true;
}
