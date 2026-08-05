import type { RpcFrame } from "./RpcProcess";

const DEVICE_PATTERN = /xd:\/\/(mcp_{1,2}[a-z0-9_.:-]+)/gi;

export function ambientMcpMounts(frame: RpcFrame): string[] {
  const names = new Set<string>();
  inspect(frame, names, false);
  return [...names].sort();
}

function inspect(value: unknown, names: Set<string>, trustedNotice: boolean): void {
  if (typeof value === "string") {
    if (!trustedNotice) return;
    for (const match of value.matchAll(DEVICE_PATTERN)) names.add(match[1]);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) inspect(item, names, trustedNotice);
    return;
  }
  if (!isRecord(value)) return;
  const customType = typeof value.customType === "string" ? value.customType : "";
  const role = typeof value.role === "string" ? value.role : "";
  const content = typeof value.content === "string" ? value.content : "";
  const isNotice =
    customType === "xdev-mount-notice" ||
    (role === "custom" && /The xd:\/\/ device inventory changed\./i.test(content));
  for (const child of Object.values(value)) {
    inspect(child, names, trustedNotice || isNotice);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
