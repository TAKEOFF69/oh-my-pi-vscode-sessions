import * as nodePath from "node:path";

const MAX_TITLE_LENGTH = 64;
const MAX_TITLE_WORDS = 10;
const LOW_SIGNAL = new Set([
  "continue",
  "go on",
  "hello",
  "hey",
  "hi",
  "look at this",
  "please continue",
  "test",
  "what do you think",
]);

export type SessionTitleSource = "provisional" | "runtime" | "manual";

export function deriveSessionTitle(prompt: string): string {
  const slash = prompt.trim().match(/^\/loop-start\s+([a-z0-9-]+)/i);
  if (slash?.[1]) {
    return truncateTitle(`Loop: ${humanizeSlug(slash[1])}`);
  }

  const candidates = prompt
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_#>]/g, " ")
    .split(/(?:[.!?]+\s+)|(?:\r?\n)+/)
    .map(cleanCandidate)
    .filter(Boolean);
  const meaningful =
    candidates.find((candidate) => !LOW_SIGNAL.has(candidate.toLowerCase())) ??
    candidates[0] ??
    "New chat";
  return truncateTitle(capitalize(meaningful));
}

export function normalizeRuntimeSessionTitle(
  value: string,
  branch?: string,
  cwd?: string,
): string | undefined {
  const title = truncateTitle(value.replace(/\s+/g, " ").trim());
  if (!title || infrastructureTitle(title, branch, cwd)) {
    return undefined;
  }
  return title;
}

export function shouldAcceptSessionTitle(
  currentSource: SessionTitleSource,
  incomingSource: "session" | "transient",
): boolean {
  return incomingSource === "session" && currentSource !== "manual";
}

export function infrastructureTitle(
  value: string,
  branch?: string,
  cwd?: string,
): boolean {
  const normalized = value.trim().replaceAll("\\", "/").toLowerCase();
  if (!normalized) return true;
  const normalizedBranch = branch?.trim().replaceAll("\\", "/").toLowerCase();
  if (normalizedBranch && normalized === normalizedBranch) return true;
  if (/^(?:wip|feature|fix|chore|refactor|release)\//i.test(normalized)) {
    return true;
  }
  if (/^[a-z]:\//i.test(normalized) || normalized.startsWith("/")) {
    return true;
  }
  if (/^[a-f0-9]{32,64}$/i.test(normalized)) return true;
  if (/omp-(?:loop-)?session-[a-z0-9-]{6,}/i.test(normalized)) return true;
  if (cwd) {
    const normalizedCwd = nodePath.resolve(cwd).replaceAll("\\", "/").toLowerCase();
    const basename = nodePath.basename(cwd).toLowerCase();
    if (normalized === normalizedCwd || normalized === basename) return true;
  }
  return false;
}

function cleanCandidate(value: string): string {
  let candidate = value
    .replace(/^[-+\d.)\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
  const fillers = [
    /^(?:can|could|would|will)\s+you\s+/i,
    /^please\s+/i,
    /^(?:hey|hi)\s*[,—-]?\s*/i,
    /^(?:i\s+)?(?:need|want|would like)\s+(?:you\s+)?to\s+/i,
    /^let(?:'|’)s\s+/i,
    /^help\s+me\s+(?:to\s+)?/i,
  ];
  for (const filler of fillers) {
    candidate = candidate.replace(filler, "").trim();
  }
  return candidate.replace(/[.!?,:;—-]+$/g, "").trim();
}

function truncateTitle(value: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean).slice(0, MAX_TITLE_WORDS);
  let title = words.join(" ");
  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH + 1).replace(/\s+\S*$/, "");
  }
  return title.replace(/[.!?,:;—-]+$/g, "").trim() || "New chat";
}

function humanizeSlug(value: string): string {
  return value.replace(/[-_]+/g, " ");
}

function capitalize(value: string): string {
  return value.replace(/^\p{Ll}/u, (letter) => letter.toLocaleUpperCase());
}
