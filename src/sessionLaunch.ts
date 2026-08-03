import type { ProjectLauncher } from "./projectLauncher";
import type { RpcParityProfile } from "./rpc/parity";
import type {
  SessionKind,
  SessionTransport,
} from "./sessions/SessionPanel";

const READ_ONLY_TOOLS =
  "read,grep,glob,lsp,inspect_image,browser,web_search,todo";
const SAFE_TOOLS = ["read", "grep", "glob", "lsp", "todo"] as const;
const POLICY_STATUS_TOOL = "dzialki_policy_status";
const LOOP_CUSTOM_TOOLS = ["loop_control", "loop_dispatch_plan"] as const;
const LOOP_TOOLS = [...LOOP_CUSTOM_TOOLS, "hub"] as const;
const WORK_TOOLS = [
  "read",
  "bash",
  "edit",
  "debug",
  "eval",
  "glob",
  "grep",
  "lsp",
  "loop_handoff",
  "browser",
  "task",
  "hub",
  "todo",
  "web_search",
  "write",
] as const;
const MUTATING_TOOLS = [
  "bash",
  "edit",
  "write",
  "delete",
  "move",
  "task",
] as const;

export type SessionLaunchPlan = {
  executable: string;
  args: string[];
  initialPrompt?: string;
  parity?: RpcParityProfile;
};

export function resolveEffectiveSessionKind(
  kind: SessionKind,
  transport: SessionTransport,
  hasTrustedProjectLauncher: boolean,
): { kind: SessionKind; blockReason?: string } {
  if (kind !== "readonly" || hasTrustedProjectLauncher) {
    return { kind };
  }
  if (transport === "terminal") {
    return { kind: "work" };
  }
  return {
    kind,
    blockReason:
      "Read-only sessions require a trusted project policy launcher; generic OMP may mount mutating extension or MCP tools.",
  };
}

export function canOfferReadOnlyDowngrade(
  hasTrustedProjectLauncher: boolean,
): boolean {
  return hasTrustedProjectLauncher;
}

export function buildSessionLaunchPlan(input: {
  kind: SessionKind;
  transport: SessionTransport;
  cwd: string;
  loopAlias?: string;
  projectLauncher?: ProjectLauncher;
  fallbackExecutable: string;
  defaultArguments?: readonly string[];
}): SessionLaunchPlan {
  const {
    kind,
    transport,
    cwd,
    loopAlias,
    projectLauncher,
    fallbackExecutable,
  } = input;
  if (kind === "loop" && !loopAlias) {
    throw new Error("Loop session requires an alias");
  }

  const executable = projectLauncher?.executable ?? fallbackExecutable;
  const args = projectLauncher
    ? [...projectLauncher.baseArgs]
    : [...(input.defaultArguments ?? [])];

  if (kind === "readonly") {
    args.push(
      projectLauncher?.readOnlyArgument ?? `--tools=${READ_ONLY_TOOLS}`,
    );
  }
  if (kind === "loop" && loopAlias) {
    if (!projectLauncher) {
      throw new Error(
        "Loop session requires repository-owned scripts/omp/launch.mjs",
      );
    }
    args.push("--loop", loopAlias);
  }
  if (transport === "rpc") {
    args.push(projectLauncher?.rpcArgument ?? "--mode=rpc");
  }

  return {
    executable,
    args,
    initialPrompt:
      transport === "rpc" && kind === "loop" && loopAlias
        ? `/loop-start ${loopAlias}`
        : undefined,
    parity:
      transport === "rpc" && projectLauncher?.parityKind === "dzialki-v1"
        ? buildDzialkiParity(kind, cwd)
        : undefined,
  };
}

function buildDzialkiParity(
  kind: SessionKind,
  cwd: string,
): RpcParityProfile {
  const requiredTools =
    kind === "loop"
      ? [...SAFE_TOOLS, ...LOOP_TOOLS, POLICY_STATUS_TOOL]
      : kind === "readonly"
        ? [...SAFE_TOOLS, POLICY_STATUS_TOOL]
        : [...WORK_TOOLS, POLICY_STATUS_TOOL];
  const allowedTools = [...requiredTools];
  const forbiddenTools =
    kind === "loop"
      ? [...MUTATING_TOOLS]
      : kind === "readonly"
        ? [...MUTATING_TOOLS, ...LOOP_TOOLS]
        : [...LOOP_CUSTOM_TOOLS];
  return {
    name: `dzialki-${kind}`,
    provider: "anthropic",
    modelId: "claude-opus-5",
    thinkingLevel: "xhigh",
    cwd,
    requiredTools,
    allowedTools,
    forbiddenTools,
  };
}
