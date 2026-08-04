export type UiContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | {
      type: "toolCall";
      id: string;
      name: string;
      arguments: unknown;
      intent?: string;
    }
  | { type: "image"; mimeType?: string; data?: string }
  | { type: "unknown"; value: unknown };

export type UiMessage = {
  key: string;
  role: "user" | "assistant" | "developer" | "toolResult" | "advisory" | "custom";
  content: UiContentBlock[];
  model?: string;
  timestamp?: number;
  streaming: boolean;
  isError?: boolean;
  customType?: string;
  display?: boolean;
};

export type UiToolRun = {
  id: string;
  name: string;
  args: unknown;
  intent?: string;
  partialResult?: unknown;
  result?: unknown;
  status: "running" | "complete" | "failed";
};

export type UiNotice = {
  id: string;
  level: "info" | "warning" | "error" | "success";
  title: string;
  detail?: string;
};

export type UiSubagent = {
  id: string;
  label: string;
  task?: string;
  status: string;
  currentTool?: string;
  tokens?: number;
};

export type UiRequest = {
  id: string;
  method: string;
  title?: string;
  message?: string;
  options?: unknown[];
  placeholder?: string;
  prefill?: string;
  timeout?: number;
};

export type UiRuntimeState = {
  model?: { provider?: string; id?: string };
  thinkingLevel?: string;
  isStreaming: boolean;
  isCompacting: boolean;
  queuedMessageCount: number;
  contextUsage?: {
    tokens?: number | null;
    contextWindow?: number | null;
    percent?: number | null;
  };
  todoPhases: unknown[];
  sessionName?: string;
  sessionId?: string;
  sessionFile?: string;
  tools: string[];
  transport: "starting" | "ready" | "exited" | "failed";
  parity: "pending" | "passed" | "failed" | "not-required";
  parityRequired?: boolean;
  parityDetail?: string;
  cwd?: string;
  branch?: string;
  kind?: string;
  advisorLabel?: string;
};

export type RpcWebviewState = {
  messages: UiMessage[];
  tools: UiToolRun[];
  notices: UiNotice[];
  subagents: UiSubagent[];
  requests: UiRequest[];
  commands: { name: string; description?: string }[];
  widgets: Record<string, unknown>;
  statuses: Record<string, string>;
  runtime: UiRuntimeState;
  sequence: number;
  liveMessageKey?: string;
};

/**
 * Project the durable OMP transcript into a human chat. OMP persists every
 * assistant/tool/advisor exchange; the chat surface keeps one answer per user
 * turn and leaves the rest available through the activity disclosure.
 */
export function selectChatMessages(messages: UiMessage[]): UiMessage[] {
  const hasVisibleUser = messages.some(
    (message) =>
      message.role === "user" &&
      message.display !== false &&
      !isSyntheticRuntimeMessage(message),
  );
  if (!hasVisibleUser) {
    return messages.filter(
      (message) =>
        message.display !== false &&
        message.role === "assistant" &&
        message.content.some(
          (block) => block.type === "text" && block.text.trim().length > 0,
        ),
    );
  }
  const visible: UiMessage[] = [];
  let turn: UiMessage[] = [];
  let suppressTurn = false;

  const flushTurn = (): void => {
    if (turn.length === 0) return;
    if (suppressTurn) {
      turn = [];
      suppressTurn = false;
      return;
    }
    const answer = [...turn]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" &&
          message.display !== false &&
          message.content.some(
            (block) =>
              (block.type === "text" && block.text.trim().length > 0) ||
              block.type === "image",
          ),
      );
    if (answer) visible.push(answer);
    for (const message of turn) {
      if (message.isError && message !== answer) visible.push(message);
    }
    turn = [];
  };

  for (const message of messages) {
    if (message.role === "user") {
      flushTurn();
      if (message.display === false || isSyntheticRuntimeMessage(message)) {
        turn.push(message);
        suppressTurn = true;
        continue;
      }
      visible.push(message);
      continue;
    }
    turn.push(message);
  }
  flushTurn();
  return visible;
}

export function countFoldedActivity(
  messages: UiMessage[],
  visibleMessages: UiMessage[],
  tools: UiToolRun[],
  subagents: UiSubagent[],
): number {
  const visibleKeys = new Set(visibleMessages.map((message) => message.key));
  const hiddenMessages = messages.filter(
    (message) =>
      !visibleKeys.has(message.key) &&
      (message.role === "advisory" ||
        message.role === "developer" ||
        message.role === "custom" ||
        message.content.some(
          (block) => block.type === "thinking" || block.type === "toolCall",
        )),
  ).length;
  return tools.length + subagents.length + hiddenMessages;
}

export function createInitialWebviewState(
  runtime: Partial<UiRuntimeState> = {},
): RpcWebviewState {
  return {
    messages: [],
    tools: [],
    notices: [],
    subagents: [],
    requests: [],
    commands: [],
    widgets: {},
    statuses: {},
    runtime: {
      isStreaming: false,
      isCompacting: false,
      queuedMessageCount: 0,
      todoPhases: [],
      tools: [],
      transport: "starting",
      parity: "pending",
      ...runtime,
    },
    sequence: 0,
  };
}

export function reduceRpcFrame(
  state: RpcWebviewState,
  raw: unknown,
): RpcWebviewState {
  if (!isRecord(raw) || typeof raw.type !== "string") {
    return state;
  }
  const next = cloneState(state);
  const frame = raw;

  switch (frame.type) {
    case "ready":
      next.runtime.transport = "ready";
      return next;
    case "agent_start":
      next.runtime.isStreaming = true;
      return next;
    case "agent_end":
      if (frame.isTerminal !== false) {
        next.runtime.isStreaming = false;
      }
      return next;
    case "turn_start":
      next.runtime.isStreaming = true;
      return next;
    case "turn_end":
      return next;
    case "message_start":
      return reduceMessage(next, frame.message, "start");
    case "message_update":
      return reduceMessage(next, frame.message, "update");
    case "message_end":
      return reduceMessage(next, frame.message, "end");
    case "tool_execution_start":
      return upsertTool(next, frame, "running");
    case "tool_execution_update":
      return upsertTool(next, frame, "running");
    case "tool_execution_end":
      return upsertTool(
        next,
        frame,
        frame.isError === true ? "failed" : "complete",
      );
    case "notice":
      addNotice(
        next,
        normalizeNoticeLevel(frame.level),
        stringValue(frame.source) || "OMP",
        stringValue(frame.message),
      );
      return next;
    case "command_output":
      addNotice(next, "info", "Command", stringValue(frame.text));
      return next;
    case "auto_compaction_start":
      next.runtime.isCompacting = true;
      addNotice(
        next,
        "warning",
        "Compacting context",
        `${stringValue(frame.action)} · ${stringValue(frame.reason)}`,
      );
      return next;
    case "auto_compaction_end":
      next.runtime.isCompacting = false;
      addNotice(
        next,
        frame.aborted === true || frame.errorMessage ? "error" : "success",
        frame.skipped === true ? "Compaction skipped" : "Compaction complete",
        stringValue(frame.errorMessage),
      );
      return next;
    case "auto_retry_start":
      addNotice(
        next,
        "warning",
        `Retry ${numberValue(frame.attempt)}/${numberValue(frame.maxAttempts)}`,
        stringValue(frame.errorMessage),
      );
      return next;
    case "auto_retry_end":
      addNotice(
        next,
        frame.success === true ? "success" : "error",
        frame.success === true ? "Retry recovered" : "Retry failed",
        stringValue(frame.finalError),
      );
      return next;
    case "ttsr_triggered":
      addNotice(
        next,
        "warning",
        "Runtime rule triggered",
        summarize(frame.rules),
      );
      return next;
    case "todo_reminder":
      addNotice(next, "warning", "Todo reminder", summarize(frame.todos));
      return next;
    case "todo_auto_clear":
      next.runtime.todoPhases = [];
      return next;
    case "thinking_level_changed":
      next.runtime.thinkingLevel = stringValue(frame.thinkingLevel);
      return next;
    case "config_update":
      if (isRecord(frame.model)) {
        next.runtime.model = {
          provider: stringValue(frame.model.provider),
          id: stringValue(frame.model.id),
        };
      }
      next.runtime.thinkingLevel =
        stringValue(frame.thinkingLevel) || next.runtime.thinkingLevel;
      return next;
    case "session_info_update":
      next.runtime.sessionName = displaySessionName(
        frame.title,
        next.runtime,
      ) || next.runtime.sessionName;
      next.runtime.sessionId =
        stringValue(frame.sessionId) || next.runtime.sessionId;
      return next;
    case "available_commands_update":
      next.commands = normalizeCommands(frame.commands);
      return next;
    case "extension_ui_request":
      return reduceUiRequest(next, frame);
    case "subagent_lifecycle":
    case "subagent_progress":
    case "subagent_event":
      return reduceSubagent(next, frame);
    case "extension_error":
      addNotice(
        next,
        "error",
        "OMP extension error",
        [
          stringValue(frame.extensionPath),
          stringValue(frame.event),
          stringValue(frame.error),
        ]
          .filter(Boolean)
          .join(" · "),
      );
      return next;
    case "prompt_result":
      if (frame.agentInvoked === false) {
        next.runtime.isStreaming = false;
      }
      return next;
    case "response":
      return reduceResponse(next, frame);
    default:
      return next;
  }
}

export function applyHostFrame(
  state: RpcWebviewState,
  raw: unknown,
): RpcWebviewState {
  if (!isRecord(raw) || typeof raw.type !== "string") {
    return state;
  }
  const next = cloneState(state);
  switch (raw.type) {
    case "bootstrap":
      next.runtime.cwd = stringValue(raw.cwd);
      next.runtime.branch = stringValue(raw.branch);
      next.runtime.sessionName = displaySessionName(
        raw.sessionName,
        next.runtime,
      ) || next.runtime.sessionName;
      next.runtime.kind = stringValue(raw.kind);
      next.runtime.advisorLabel = stringValue(raw.advisorLabel);
      next.runtime.parityRequired = raw.parityRequired !== false;
      next.runtime.parity =
        raw.parityRequired === false ? "not-required" : "pending";
      return next;
    case "transport":
      next.runtime.transport = normalizeTransport(raw.status);
      if (raw.detail) {
        addNotice(
          next,
          raw.status === "failed" ? "error" : "info",
          "OMP transport",
          stringValue(raw.detail),
        );
      }
      return next;
    case "parity":
      next.runtime.parity =
        raw.ok === true ? "passed" : "failed";
      next.runtime.parityDetail = stringValue(raw.detail);
      if (raw.ok !== true) {
        addNotice(
          next,
          "error",
          "Runtime parity blocked",
          stringValue(raw.detail),
        );
      }
      return next;
    case "stderr":
      addNotice(next, "info", "Launcher", stringValue(raw.text));
      return next;
    default:
      return state;
  }
}

function reduceResponse(
  state: RpcWebviewState,
  frame: Record<string, unknown>,
): RpcWebviewState {
  if (frame.success !== true) {
    if (
      (frame.command === "get_messages" ||
        frame.command === "get_messages_page") &&
      frame.code === "session_busy"
    ) {
      return state;
    }
    addNotice(
      state,
      "error",
      `${stringValue(frame.command) || "RPC"} failed`,
      [stringValue(frame.code), stringValue(frame.error)]
        .filter(Boolean)
        .join(" · "),
    );
    return state;
  }
  if (!isRecord(frame.data)) {
    return state;
  }
  if (frame.command === "get_state") {
    const data = frame.data;
    if (isRecord(data.model)) {
      state.runtime.model = {
        provider: stringValue(data.model.provider),
        id: stringValue(data.model.id),
      };
    }
    state.runtime.thinkingLevel = stringValue(data.thinkingLevel);
    state.runtime.isStreaming = data.isStreaming === true;
    state.runtime.isCompacting = data.isCompacting === true;
    state.runtime.queuedMessageCount = numberValue(data.queuedMessageCount);
    state.runtime.sessionName = displaySessionName(
      data.sessionName,
      state.runtime,
    ) || state.runtime.sessionName;
    state.runtime.sessionId = stringValue(data.sessionId);
    state.runtime.sessionFile = stringValue(data.sessionFile);
    state.runtime.contextUsage = isRecord(data.contextUsage)
      ? {
          tokens: nullableNumber(data.contextUsage.tokens),
          contextWindow: nullableNumber(data.contextUsage.contextWindow),
          percent: nullableNumber(data.contextUsage.percent),
        }
      : undefined;
    state.runtime.todoPhases = Array.isArray(data.todoPhases)
      ? data.todoPhases
      : [];
    state.runtime.tools = Array.isArray(data.dumpTools)
      ? data.dumpTools
          .map((tool) =>
            isRecord(tool) ? stringValue(tool.name) : "",
          )
          .filter(Boolean)
      : [];
    return state;
  }
  if (frame.command === "get_messages") {
    state.messages = Array.isArray(frame.data.messages)
      ? frame.data.messages.map((message, index) =>
          normalizeMessage(message, `history-${index}`, false),
        )
      : [];
    state.liveMessageKey = undefined;
    return state;
  }
  if (frame.command === "get_available_commands") {
    state.commands = normalizeCommands(frame.data.commands);
  }
  return state;
}

function isSyntheticRuntimeMessage(message: UiMessage): boolean {
  const text = message.content
    .filter((block): block is Extract<UiContentBlock, { type: "text" }> =>
      block.type === "text",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
  return (
    /^###\s+Session update\b/i.test(text) ||
    /^<task-notification\b/i.test(text) ||
    /^<advisory\b/i.test(text)
  );
}

function displaySessionName(
  raw: unknown,
  runtime: Pick<UiRuntimeState, "branch" | "cwd">,
): string {
  const value = stringValue(raw).replace(/\s+/g, " ").trim();
  if (!value) return "";
  const normalized = value.replaceAll("\\", "/").toLowerCase();
  const branch = runtime.branch?.replaceAll("\\", "/").toLowerCase();
  const cwd = runtime.cwd
    ?.replaceAll("\\", "/")
    .replace(/\/$/, "")
    .toLowerCase();
  const cwdBase = cwd?.split("/").pop();
  if (
    normalized === branch ||
    normalized === cwd ||
    normalized === cwdBase ||
    /^(?:wip|feature|fix|chore|refactor|release)\//.test(normalized) ||
    /^(?:[a-z]:\/|\/)/.test(normalized) ||
    /^[a-f0-9]{32,64}$/.test(normalized) ||
    /omp-(?:loop-)?session-[a-z0-9-]{6,}/.test(normalized)
  ) {
    return "";
  }
  return value;
}

function reduceMessage(
  state: RpcWebviewState,
  value: unknown,
  phase: "start" | "update" | "end",
): RpcWebviewState {
  if (!isRecord(value)) {
    return state;
  }
  if (phase === "start" || !state.liveMessageKey) {
    const key = `live-${++state.sequence}`;
    state.liveMessageKey = key;
    state.messages.push(normalizeMessage(value, key, phase !== "end"));
  } else {
    const index = state.messages.findIndex(
      (message) => message.key === state.liveMessageKey,
    );
    const normalized = normalizeMessage(
      value,
      state.liveMessageKey,
      phase !== "end",
    );
    if (index >= 0) {
      state.messages[index] = normalized;
    } else {
      state.messages.push(normalized);
    }
  }
  if (phase === "end") {
    state.liveMessageKey = undefined;
  }
  return state;
}

function normalizeMessage(
  value: unknown,
  key: string,
  streaming: boolean,
): UiMessage {
  const message = isRecord(value) ? value : {};
  const rawRole = stringValue(message.role);
  const customType = stringValue(message.customType);
  const rawContent = message.content;
  const role = normalizeRole(rawRole, customType, rawContent);
  return {
    key,
    role,
    content: normalizeContent(rawContent),
    model: stringValue(message.model) || undefined,
    timestamp:
      typeof message.timestamp === "number" ? message.timestamp : undefined,
    streaming,
    isError: message.isError === true,
    customType: customType || undefined,
    display: typeof message.display === "boolean" ? message.display : undefined,
  };
}

function normalizeRole(
  role: string,
  customType: string,
  content: unknown,
): UiMessage["role"] {
  const contentText =
    typeof content === "string" ? content : summarize(content);
  if (
    role === "custom" &&
    (/advisor|advisory/i.test(customType) ||
      /<advisory\b/i.test(contentText))
  ) {
    return "advisory";
  }
  switch (role) {
    case "user":
    case "assistant":
    case "developer":
    case "toolResult":
      return role;
    case "custom":
      return "custom";
    default:
      return "custom";
  }
}

function normalizeContent(value: unknown): UiContentBlock[] {
  if (typeof value === "string") {
    return [{ type: "text", text: value }];
  }
  if (!Array.isArray(value)) {
    return [{ type: "unknown", value }];
  }
  return value.map((block): UiContentBlock => {
    if (!isRecord(block)) {
      return { type: "unknown", value: block };
    }
    switch (block.type) {
      case "text":
        return { type: "text", text: stringValue(block.text) };
      case "thinking":
        return {
          type: "thinking",
          thinking: stringValue(block.thinking),
        };
      case "toolCall":
        return {
          type: "toolCall",
          id: stringValue(block.id),
          name: stringValue(block.name),
          arguments: block.arguments,
          intent: stringValue(block.intent) || undefined,
        };
      case "image":
        return {
          type: "image",
          mimeType: stringValue(block.mimeType) || undefined,
          data: stringValue(block.data) || undefined,
        };
      default:
        return { type: "unknown", value: block };
    }
  });
}

function upsertTool(
  state: RpcWebviewState,
  frame: Record<string, unknown>,
  status: UiToolRun["status"],
): RpcWebviewState {
  const id = stringValue(frame.toolCallId);
  if (!id) {
    return state;
  }
  const existing = state.tools.find((tool) => tool.id === id);
  const update: UiToolRun = {
    id,
    name: stringValue(frame.toolName) || existing?.name || "tool",
    args: frame.args ?? existing?.args,
    intent: stringValue(frame.intent) || existing?.intent,
    partialResult: frame.partialResult ?? existing?.partialResult,
    result: frame.result ?? existing?.result,
    status,
  };
  if (existing) {
    Object.assign(existing, update);
  } else {
    state.tools.push(update);
  }
  state.tools = state.tools.slice(-40);
  return state;
}

function reduceUiRequest(
  state: RpcWebviewState,
  frame: Record<string, unknown>,
): RpcWebviewState {
  const method = stringValue(frame.method);
  if (method === "notify") {
    addNotice(
      state,
      normalizeNoticeLevel(frame.notifyType ?? frame.level),
      stringValue(frame.title) || "OMP",
      stringValue(frame.message),
    );
    return state;
  }
  if (method === "setStatus") {
    const key =
      stringValue(frame.statusKey) ||
      stringValue(frame.key) ||
      stringValue(frame.id) ||
      "status";
    const text =
      stringValue(frame.statusText) ||
      stringValue(frame.text) ||
      stringValue(frame.message);
    if (text) {
      state.statuses[key] = text;
    } else {
      delete state.statuses[key];
    }
    return state;
  }
  if (method === "setWidget") {
    const key =
      stringValue(frame.widgetKey) ||
      stringValue(frame.key) ||
      stringValue(frame.id) ||
      "widget";
    if (Array.isArray(frame.widgetLines)) {
      state.widgets[key] = {
        lines: frame.widgetLines.map((line) => stringValue(line)),
        placement: stringValue(frame.widgetPlacement) || "aboveEditor",
      };
    } else {
      delete state.widgets[key];
    }
    return state;
  }
  if (method === "cancel") {
    const targetId = stringValue(frame.targetId);
    state.requests = state.requests.filter(
      (request) => request.id !== targetId,
    );
    return state;
  }
  if (
    method === "setTitle" ||
    method === "set_editor_text" ||
    method === "setEditorText" ||
    method === "open_url"
  ) {
    return state;
  }
  const id = stringValue(frame.id);
  if (!id) {
    return state;
  }
  state.requests.push({
    id,
    method,
    title: stringValue(frame.title) || undefined,
    message: stringValue(frame.message) || undefined,
    options: Array.isArray(frame.options) ? frame.options : undefined,
    placeholder: stringValue(frame.placeholder) || undefined,
    prefill: stringValue(frame.prefill) || undefined,
    timeout: typeof frame.timeout === "number" ? frame.timeout : undefined,
  });
  return state;
}

function reduceSubagent(
  state: RpcWebviewState,
  frame: Record<string, unknown>,
): RpcWebviewState {
  const payload = isRecord(frame.payload)
    ? frame.payload
    : isRecord(frame.data)
      ? frame.data
      : frame;
  const progress = isRecord(payload.progress) ? payload.progress : payload;
  const id =
    stringValue(progress.subagentId) ||
    stringValue(payload.subagentId) ||
    stringValue(progress.id) ||
    stringValue(payload.id) ||
    stringValue(payload.agent);
  if (!id) {
    return state;
  }
  const existing = state.subagents.find((agent) => agent.id === id);
  const update: UiSubagent = {
    id,
    label:
      stringValue(payload.agent) ||
      stringValue(progress.agent) ||
      stringValue(payload.name) ||
      stringValue(progress.name) ||
      existing?.label ||
      id,
    task:
      stringValue(payload.task) ||
      stringValue(progress.task) ||
      stringValue(payload.currentTask) ||
      stringValue(progress.currentTask) ||
      existing?.task,
    status:
      stringValue(progress.status) ||
      stringValue(payload.status) ||
      stringValue(payload.event) ||
      existing?.status ||
      "running",
    currentTool:
      stringValue(progress.currentTool) ||
      stringValue(progress.toolName) ||
      existing?.currentTool,
    tokens:
      typeof progress.tokens === "number"
        ? progress.tokens
        : existing?.tokens,
  };
  if (existing) {
    Object.assign(existing, update);
  } else {
    state.subagents.push(update);
  }
  return state;
}

function addNotice(
  state: RpcWebviewState,
  level: UiNotice["level"],
  title: string,
  detail?: string,
): void {
  state.notices.push({
    id: `notice-${++state.sequence}`,
    level,
    title,
    detail: detail || undefined,
  });
  state.notices = state.notices.slice(-30);
}

function normalizeCommands(value: unknown): RpcWebviewState["commands"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((command) => {
      if (typeof command === "string") {
        return { name: command };
      }
      if (!isRecord(command)) {
        return null;
      }
      const name =
        stringValue(command.name) ||
        stringValue(command.command) ||
        stringValue(command.label);
      return name
        ? {
            name,
            description:
              stringValue(command.description) || undefined,
          }
        : null;
    })
    .filter(
      (
        command,
      ): command is { name: string; description?: string } =>
        command !== null,
    );
}

function cloneState(state: RpcWebviewState): RpcWebviewState {
  return {
    ...state,
    messages: [...state.messages],
    tools: state.tools.map((tool) => ({ ...tool })),
    notices: [...state.notices],
    subagents: state.subagents.map((agent) => ({ ...agent })),
    requests: [...state.requests],
    commands: [...state.commands],
    widgets: { ...state.widgets },
    statuses: { ...state.statuses },
    runtime: {
      ...state.runtime,
      model: state.runtime.model
        ? { ...state.runtime.model }
        : undefined,
      contextUsage: state.runtime.contextUsage
        ? { ...state.runtime.contextUsage }
        : undefined,
      todoPhases: [...state.runtime.todoPhases],
      tools: [...state.runtime.tools],
    },
  };
}

function normalizeNoticeLevel(value: unknown): UiNotice["level"] {
  switch (value) {
    case "warning":
      return "warning";
    case "error":
      return "error";
    case "success":
      return "success";
    default:
      return "info";
  }
}

function normalizeTransport(value: unknown): UiRuntimeState["transport"] {
  switch (value) {
    case "ready":
    case "exited":
    case "failed":
      return value;
    default:
      return "starting";
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function summarize(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
