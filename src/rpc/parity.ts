import * as nodePath from "node:path";

export type RpcStateModel = {
  provider?: unknown;
  id?: unknown;
};

export type RpcStateTool = {
  name?: unknown;
};

export type RpcSessionState = {
  model?: RpcStateModel | null;
  thinkingLevel?: unknown;
  sessionFile?: unknown;
  sessionId?: unknown;
  sessionName?: unknown;
  isStreaming?: unknown;
  isCompacting?: unknown;
  queuedMessageCount?: unknown;
  autoCompactionEnabled?: unknown;
  todoPhases?: unknown;
  contextUsage?: unknown;
  dumpTools?: RpcStateTool[];
  cwd?: unknown;
};

export type RpcParityProfile = {
  name: string;
  provider: string;
  modelId: string;
  thinkingLevel: string;
  cwd: string;
  requiredTools: readonly string[];
  allowedTools?: readonly string[];
  forbiddenTools: readonly string[];
};

export type RpcParityFinding = {
  code:
    | "model-provider"
    | "model-id"
    | "thinking-level"
    | "cwd"
    | "missing-tool"
    | "forbidden-tool"
    | "unexpected-tool";
  expected: string;
  actual: string;
};

export type RpcRuntimeConfigFrame = {
  type?: unknown;
  command?: unknown;
  success?: unknown;
  model?: RpcStateModel | null;
  thinkingLevel?: unknown;
  data?: unknown;
};

export function validateRpcParity(
  state: RpcSessionState,
  profile: RpcParityProfile,
): RpcParityFinding[] {
  const findings: RpcParityFinding[] = [];
  const provider =
    typeof state.model?.provider === "string" ? state.model.provider : "";
  const modelId = typeof state.model?.id === "string" ? state.model.id : "";
  const thinkingLevel =
    typeof state.thinkingLevel === "string" ? state.thinkingLevel : "";
  const cwd = typeof state.cwd === "string" ? state.cwd : "";
  const tools = new Set(
    (Array.isArray(state.dumpTools) ? state.dumpTools : [])
      .map((tool) => (typeof tool?.name === "string" ? tool.name : ""))
      .filter(Boolean),
  );

  if (provider !== profile.provider) {
    findings.push({
      code: "model-provider",
      expected: profile.provider,
      actual: provider || "<missing>",
    });
  }
  if (modelId !== profile.modelId) {
    findings.push({
      code: "model-id",
      expected: profile.modelId,
      actual: modelId || "<missing>",
    });
  }
  if (thinkingLevel !== profile.thinkingLevel) {
    findings.push({
      code: "thinking-level",
      expected: profile.thinkingLevel,
      actual: thinkingLevel || "<missing>",
    });
  }
  if (!sameDirectory(cwd, profile.cwd)) {
    findings.push({
      code: "cwd",
      expected: nodePath.resolve(profile.cwd),
      actual: cwd ? nodePath.resolve(cwd) : "<missing>",
    });
  }

  for (const tool of profile.requiredTools) {
    if (!tools.has(tool)) {
      findings.push({
        code: "missing-tool",
        expected: tool,
        actual: [...tools].sort().join(", ") || "<none>",
      });
    }
  }
  for (const tool of profile.forbiddenTools) {
    if (tools.has(tool)) {
      findings.push({
        code: "forbidden-tool",
        expected: `without ${tool}`,
        actual: tool,
      });
    }
  }
  if (profile.allowedTools) {
    const allowedTools = new Set(profile.allowedTools);
    for (const tool of [...tools].sort()) {
      if (!allowedTools.has(tool)) {
        findings.push({
          code: "unexpected-tool",
          expected: [...allowedTools].sort().join(", ") || "<none>",
          actual: tool,
        });
      }
    }
  }
  return findings;
}

/**
 * Validate the mutable runtime dimensions emitted after startup. OMP allows
 * model cycling over RPC, so launch-time parity alone is not a durable lock.
 */
export function validateRpcRuntimeConfigFrame(
  frame: RpcRuntimeConfigFrame,
  profile: RpcParityProfile,
): RpcParityFinding[] {
  const dimensions = runtimeConfigDimensions(frame);
  if (!dimensions) return [];

  const findings: RpcParityFinding[] = [];
  const provider =
    typeof dimensions.model?.provider === "string"
      ? dimensions.model.provider
      : "";
  const modelId =
    typeof dimensions.model?.id === "string" ? dimensions.model.id : "";
  const thinkingLevel =
    typeof dimensions.thinkingLevel === "string"
      ? dimensions.thinkingLevel
      : "";

  if (dimensions.checkModel && provider !== profile.provider) {
    findings.push({
      code: "model-provider",
      expected: profile.provider,
      actual: provider || "<missing>",
    });
  }
  if (dimensions.checkModel && modelId !== profile.modelId) {
    findings.push({
      code: "model-id",
      expected: profile.modelId,
      actual: modelId || "<missing>",
    });
  }
  if (dimensions.checkThinking && thinkingLevel !== profile.thinkingLevel) {
    findings.push({
      code: "thinking-level",
      expected: profile.thinkingLevel,
      actual: thinkingLevel || "<missing>",
    });
  }
  return findings;
}

function runtimeConfigDimensions(frame: RpcRuntimeConfigFrame): {
  model?: RpcStateModel | null;
  thinkingLevel?: unknown;
  checkModel: boolean;
  checkThinking: boolean;
} | undefined {
  if (frame.type === "config_update") {
    return {
      model: frame.model,
      thinkingLevel: frame.thinkingLevel,
      checkModel: true,
      checkThinking: true,
    };
  }
  if (frame.type === "thinking_level_changed") {
    return {
      thinkingLevel: frame.thinkingLevel,
      checkModel: false,
      checkThinking: true,
    };
  }
  if (frame.type === "model_changed") {
    return {
      model: frame.model,
      checkModel: true,
      checkThinking: false,
    };
  }
  if (frame.type !== "response" || frame.success !== true) return undefined;

  const command = typeof frame.command === "string" ? frame.command : "";
  const data = isRecord(frame.data) ? frame.data : {};
  if (["get_state", "set_model", "cycle_model"].includes(command)) {
    return {
      model: isRecord(data.model) ? data.model : null,
      thinkingLevel: data.thinkingLevel,
      checkModel: true,
      checkThinking: command === "get_state" || "thinkingLevel" in data,
    };
  }
  if (["set_thinking_level", "cycle_thinking_level"].includes(command)) {
    // OMP 17.1.3 emits the authoritative thinking_level_changed event and an
    // empty successful response for set_thinking_level. Validate response data
    // only when it actually carries the new level.
    if (!("thinkingLevel" in data)) return undefined;
    return {
      thinkingLevel: data.thinkingLevel,
      checkModel: false,
      checkThinking: true,
    };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatRpcParityFindings(
  findings: readonly RpcParityFinding[],
): string {
  return findings
    .map(
      (finding) =>
        `${finding.code}: expected ${finding.expected}; received ${finding.actual}`,
    )
    .join("\n");
}

function sameDirectory(left: string, right: string): boolean {
  if (!left || !right) {
    return false;
  }
  const normalize = (value: string) => {
    const resolved = nodePath.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}
