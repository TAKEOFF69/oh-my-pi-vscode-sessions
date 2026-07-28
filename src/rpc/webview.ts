import MarkdownIt from "markdown-it";

import "./webview.css";

type WindowWithFind = Window & {
  find?: (
    text: string,
    caseSensitive?: boolean,
    backwards?: boolean,
    wrapAround?: boolean,
    wholeWord?: boolean,
    searchInFrames?: boolean,
    showDialog?: boolean,
  ) => boolean;
};
import {
  applyHostFrame,
  createInitialWebviewState,
  reduceRpcFrame,
  type RpcWebviewState,
  type UiContentBlock,
  type UiMessage,
  type UiRequest,
  type UiToolRun,
} from "./webviewState";

type VsCodeState = {
  draft?: string;
};

type VsCodeApi = {
  postMessage(message: unknown): void;
  getState(): VsCodeState | undefined;
  setState(state: VsCodeState): void;
};

declare global {
  interface Window {
    __OMP_RPC_FIXTURE__?: unknown[];
  }
}

declare const acquireVsCodeApi: (() => VsCodeApi) | undefined;

const vscode: VsCodeApi =
  typeof acquireVsCodeApi === "function"
    ? acquireVsCodeApi()
    : {
        postMessage(message) {
          window.dispatchEvent(
            new CustomEvent("omp-fixture-post", { detail: message }),
          );
        },
        getState: () => undefined,
        setState: () => undefined,
      };

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});
let state = createInitialWebviewState();
let renderPending = false;
let userPinnedScroll = false;
let commandSelection = 0;

const root = requireElement("app");
root.innerHTML = `
  <main class="app">
    <header class="run-rail" aria-label="OMP runtime">
      <div class="identity">
        <div class="pi-mark" aria-hidden="true">π</div>
        <div class="identity-copy">
          <div id="session-name" class="session-name">OMP session</div>
          <div id="session-path" class="session-path">Starting runtime…</div>
        </div>
      </div>
      <div id="rail-signals" class="rail-signals"></div>
    </header>
    <section class="workspace">
      <div id="stream" class="stream" tabindex="-1">
        <div id="stream-inner" class="stream-inner"></div>
      </div>
      <div id="search-box" class="search-box" hidden>
        <label class="sr-only" for="search-input">Find in session</label>
        <input id="search-input" type="search" placeholder="Find in session" />
      </div>
      <div id="request-layer" class="request-layer" hidden></div>
      <div class="composer-shell">
        <div class="composer">
          <div id="command-menu" class="command-menu" hidden></div>
          <label class="sr-only" for="composer-input">Message OMP</label>
          <textarea
            id="composer-input"
            rows="2"
            placeholder="Message Opus · / for commands"
            spellcheck="true"
          ></textarea>
          <div class="composer-bar">
            <button id="logs-button" class="button icon secondary" type="button" title="Show OMP logs">≡</button>
            <button id="terminal-button" class="button secondary" type="button" title="Open diagnostic terminal">Terminal</button>
            <div id="composer-status" class="composer-status">RPC starting</div>
            <button id="abort-button" class="button danger" type="button" hidden>Stop</button>
            <button id="follow-button" class="button secondary" type="button" hidden>Follow up</button>
            <button id="steer-button" class="button secondary" type="button" hidden>Steer</button>
            <button id="send-button" class="button primary" type="button">Send ↗</button>
          </div>
        </div>
      </div>
    </section>
  </main>
`;

const stream = requireElement("stream");
const streamInner = requireElement("stream-inner");
const composer = requireTextArea("composer-input");
const sendButton = requireButton("send-button");
const steerButton = requireButton("steer-button");
const followButton = requireButton("follow-button");
const abortButton = requireButton("abort-button");
const logsButton = requireButton("logs-button");
const terminalButton = requireButton("terminal-button");
const commandMenu = requireElement("command-menu");
const requestLayer = requireElement("request-layer");
const searchBox = requireElement("search-box");
const searchInput = requireInput("search-input");

composer.value = vscode.getState()?.draft ?? "";
resizeComposer();

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  receiveHostMessage(event.data);
});
window.addEventListener("omp-fixture-frame", (event) => {
  receiveHostMessage((event as CustomEvent).detail);
});

stream.addEventListener("scroll", () => {
  const remaining =
    stream.scrollHeight - stream.scrollTop - stream.clientHeight;
  userPinnedScroll = remaining > 90;
});
composer.addEventListener("input", () => {
  vscode.setState({ draft: composer.value });
  resizeComposer();
  renderCommandMenu();
});
composer.addEventListener("keydown", (event) => {
  const commandsVisible = !commandMenu.hidden;
  if (commandsVisible && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault();
    const count = filteredCommands().length;
    if (count > 0) {
      commandSelection =
        (commandSelection + (event.key === "ArrowDown" ? 1 : -1) + count) %
        count;
      renderCommandMenu();
    }
    return;
  }
  if (commandsVisible && event.key === "Tab") {
    event.preventDefault();
    chooseCommand(commandSelection);
    return;
  }
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.ctrlKey
  ) {
    event.preventDefault();
    if (commandsVisible && composer.value.trim().startsWith("/")) {
      chooseCommand(commandSelection);
    } else {
      submit("prompt");
    }
  } else if (
    event.key === "Enter" &&
    (event.ctrlKey || event.metaKey) &&
    state.runtime.isStreaming
  ) {
    event.preventDefault();
    submit("steer");
  } else if (event.key === "Escape" && state.runtime.isStreaming) {
    event.preventDefault();
    post({ type: "abort" });
  }
});
sendButton.addEventListener("click", () => submit("prompt"));
steerButton.addEventListener("click", () => submit("steer"));
followButton.addEventListener("click", () => submit("follow_up"));
abortButton.addEventListener("click", () => post({ type: "abort" }));
logsButton.addEventListener("click", () => post({ type: "showLogs" }));
terminalButton.addEventListener("click", () =>
  post({ type: "openDiagnosticTerminal" }),
);
searchInput.addEventListener("input", () => {
  const query = searchInput.value;
  const find = (window as WindowWithFind).find;
  if (query && typeof find === "function") {
    find.call(window, query, false, false, true, false, true, false);
  }
});
document.addEventListener(
  "keydown",
  (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      toggleSearch(true);
    } else if (event.key === "Escape" && !searchBox.hidden) {
      event.preventDefault();
      toggleSearch(false);
    }
  },
  true,
);
document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  const anchor = target.closest("a");
  if (anchor instanceof HTMLAnchorElement) {
    event.preventDefault();
    post({ type: "openUrl", uri: anchor.href });
    return;
  }
  const fileButton = target.closest<HTMLElement>("[data-open-file]");
  if (fileButton) {
    post({
      type: "openFile",
      path: fileButton.dataset.openFile,
      line: numberData(fileButton.dataset.line),
      col: numberData(fileButton.dataset.col),
    });
    return;
  }
  const toolToggle = target.closest<HTMLElement>("[data-tool-toggle]");
  if (toolToggle) {
    const details = document.querySelector<HTMLElement>(
      `[data-tool-details="${cssEscape(toolToggle.dataset.toolToggle ?? "")}"]`,
    );
    if (details) {
      details.hidden = !details.hidden;
    }
  }
});

post({ type: "ready" });
for (const frame of window.__OMP_RPC_FIXTURE__ ?? []) {
  receiveHostMessage(frame);
}
scheduleRender();

function receiveHostMessage(raw: unknown): void {
  if (!isRecord(raw) || typeof raw.type !== "string") {
    return;
  }
  switch (raw.type) {
    case "rpc":
      state = reduceRpcFrame(state, raw.frame);
      break;
    case "insertText":
      insertText(String(raw.text ?? ""));
      return;
    case "setComposer":
      composer.value = String(raw.text ?? "");
      vscode.setState({ draft: composer.value });
      resizeComposer();
      composer.focus();
      return;
    case "restoreDraft": {
      const restored = String(raw.text ?? "").trim();
      if (restored) {
        composer.value = composer.value.trim()
          ? `${restored}\n\n${composer.value}`
          : restored;
        vscode.setState({ draft: composer.value });
        resizeComposer();
        composer.focus();
      }
      return;
    }
    case "focus":
      composer.focus();
      return;
    case "search":
      toggleSearch(true);
      return;
    case "removeRequest":
      state = {
        ...state,
        requests: state.requests.filter(
          (request) => request.id !== raw.id,
        ),
      };
      break;
    default:
      state = applyHostFrame(state, raw);
      break;
  }
  scheduleRender();
}

function scheduleRender(): void {
  if (renderPending) {
    return;
  }
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    render();
  });
}

function render(): void {
  renderRail();
  renderTimeline();
  renderComposer();
  renderRequest();
  renderCommandMenu();
}

function renderRail(): void {
  requireElement("session-name").textContent =
    state.runtime.sessionName ||
    state.runtime.branch ||
    "OMP session";
  requireElement("session-path").textContent = [
    state.runtime.branch,
    state.runtime.cwd,
  ]
    .filter(Boolean)
    .join(" · ");

  const model = [
    state.runtime.model?.provider,
    state.runtime.model?.id,
  ]
    .filter(Boolean)
    .join("/");
  const context = state.runtime.contextUsage;
  const contextPercent =
    context?.percent === undefined || context.percent === null
      ? "—"
      : `${normalizePercent(context.percent)}%`;
  const signals = [
    signal(
      state.runtime.transport,
      "RPC",
      state.runtime.transport,
    ),
    signal(
      state.runtime.parity,
      "Parity",
      state.runtime.parity,
    ),
    signal(
      state.runtime.isStreaming ? "running" : "ready",
      model || "model pending",
      state.runtime.thinkingLevel || "—",
    ),
    signal(
      "ready",
      "Advisor",
      state.runtime.advisorLabel || "project policy",
      "optional",
    ),
    signal(
      state.runtime.isCompacting ? "running" : "ready",
      "Context",
      contextPercent,
      "optional",
    ),
    signal(
      state.runtime.queuedMessageCount > 0 ? "pending" : "ready",
      "Queue",
      String(state.runtime.queuedMessageCount),
      "optional",
    ),
  ];
  requireElement("rail-signals").innerHTML = signals.join("");
}

function renderTimeline(): void {
  const shouldFollow = !userPinnedScroll;
  const chunks: string[] = [];
  if (state.runtime.parity === "failed") {
    chunks.push(`
      <section class="fatal-banner" role="alert">
        <strong>Runtime parity blocked this session</strong>
        <pre>${escapeHtml(state.runtime.parityDetail || "Unknown parity failure")}</pre>
      </section>
    `);
  }

  if (
    state.messages.length === 0 &&
    state.tools.length === 0 &&
    state.notices.length === 0
  ) {
    chunks.push(renderEmpty());
  } else {
    chunks.push('<div class="timeline">');
    if (
      Object.keys(state.statuses).length > 0 ||
      Object.keys(state.widgets).length > 0
    ) {
      chunks.push(renderExtensionSurfaces());
    }
    if (state.notices.length > 0) {
      chunks.push(renderNotices());
    }
    for (const message of state.messages) {
      chunks.push(renderMessage(message));
    }
    if (state.tools.length > 0) {
      chunks.push(renderTools(state.tools.slice(-12)));
    }
    if (state.subagents.length > 0) {
      chunks.push(renderAgents());
    }
    chunks.push("</div>");
  }
  streamInner.innerHTML = chunks.join("");
  if (shouldFollow) {
    stream.scrollTop = stream.scrollHeight;
  }
}

function renderEmpty(): string {
  const mode =
    state.runtime.kind === "loop"
      ? "Loop controller"
      : state.runtime.kind === "readonly"
        ? "Read-only session"
        : "OMP session";
  return `
    <section class="empty-state">
      <div class="empty-card">
        <div class="empty-kicker">${escapeHtml(mode)} · structured RPC</div>
        <h1>One worktree. One clear line of flight.</h1>
        <p>
          OMP remains the runtime. This tab renders its model turns, advisor interventions,
          tool calls, and Loop control without parsing terminal text.
        </p>
        <div class="shortcut-row">
          <kbd>Enter</kbd><span>send</span>
          <kbd>Shift + Enter</kbd><span>newline</span>
          <kbd>Ctrl + Enter</kbd><span>steer</span>
          <kbd>Esc</kbd><span>stop</span>
        </div>
      </div>
    </section>
  `;
}

function renderMessage(message: UiMessage): string {
  if (message.role === "toolResult" && !message.isError) {
    return "";
  }
  const label = {
    user: "You",
    assistant: "Opus",
    developer: "Runtime",
    toolResult: "Tool",
    advisory: "Advisor",
    custom: message.customType || "OMP",
  }[message.role];
  const avatar = {
    user: "YOU",
    assistant: "π",
    developer: "SYS",
    toolResult: "TOOL",
    advisory: "SOL",
    custom: "OMP",
  }[message.role];
  const content = message.content.map(renderContent).join("");
  return `
    <article class="message ${message.role}">
      <div class="avatar" aria-hidden="true">${escapeHtml(avatar)}</div>
      <div class="message-body">
        <div class="message-meta">
          <strong>${escapeHtml(label)}</strong>
          ${message.model ? `<span>${escapeHtml(message.model)}</span>` : ""}
          ${message.streaming ? "<span>streaming</span>" : ""}
        </div>
        <div class="content">
          ${content}
          ${message.streaming ? '<span class="streaming-caret" aria-label="Streaming"></span>' : ""}
        </div>
      </div>
    </article>
  `;
}

function renderContent(block: UiContentBlock): string {
  switch (block.type) {
    case "text": {
      const text = block.text
        .replace(/<advisory\b[^>]*>/gi, "")
        .replace(/<\/advisory>/gi, "");
      return `<div class="markdown">${markdown.render(text)}</div>`;
    }
    case "thinking":
      return `
        <details class="thinking">
          <summary>Reasoning trace</summary>
          <div class="thinking-body markdown">${markdown.render(block.thinking)}</div>
        </details>
      `;
    case "toolCall":
      return `
        <div class="tool-card">
          <div class="tool-head">
            <span class="tool-icon">↳</span>
            <div class="tool-copy">
              <div class="tool-name">${escapeHtml(block.name)}</div>
              <div class="tool-intent">${escapeHtml(block.intent || "queued tool call")}</div>
            </div>
            <span class="tool-status">queued</span>
          </div>
        </div>
      `;
    case "image":
      return '<div class="notice-detail">Image attached to model context</div>';
    case "unknown":
      return `<pre class="json">${escapeHtml(pretty(block.value))}</pre>`;
  }
}

function renderTools(tools: UiToolRun[]): string {
  return `
    <section class="tool-deck" aria-label="Tool execution">
      ${tools.map(renderTool).join("")}
    </section>
  `;
}

function renderTool(tool: UiToolRun): string {
  const filePath = extractFilePath(tool.args);
  return `
    <article class="tool-card ${tool.status}">
      <button class="tool-head" type="button" data-tool-toggle="${escapeAttr(tool.id)}">
        <span class="tool-icon">${tool.status === "running" ? "●" : tool.status === "failed" ? "!" : "✓"}</span>
        <span class="tool-copy">
          <span class="tool-name">${escapeHtml(tool.name)}</span>
          <span class="tool-intent">${escapeHtml(tool.intent || summarizeArgs(tool.args))}</span>
        </span>
        <span class="tool-status">${escapeHtml(tool.status)}</span>
      </button>
      <div class="tool-details" data-tool-details="${escapeAttr(tool.id)}" hidden>
        ${
          filePath
            ? `<div class="tool-actions"><button class="button" type="button" data-open-file="${escapeAttr(filePath)}">Open file</button></div>`
            : ""
        }
        <pre class="json">${escapeHtml(pretty({
          args: tool.args,
          partialResult: tool.partialResult,
          result: tool.result,
        }))}</pre>
      </div>
    </article>
  `;
}

function renderNotices(): string {
  return `
    <section class="notice-stack" aria-label="OMP notices">
      ${state.notices
        .slice(-8)
        .map(
          (notice) => `
            <article class="notice ${notice.level}">
              <span class="notice-bar"></span>
              <div class="notice-copy">
                <div class="notice-title">${escapeHtml(notice.title)}</div>
                ${notice.detail ? `<div class="notice-detail">${escapeHtml(notice.detail)}</div>` : ""}
              </div>
            </article>
          `,
        )
        .join("")}
    </section>
  `;
}

function renderAgents(): string {
  return `
    <details class="agents" open>
      <summary>${state.subagents.length} active/recent OMP subagent${state.subagents.length === 1 ? "" : "s"}</summary>
      <div class="agent-grid">
        ${state.subagents
          .map(
            (agent) => `
              <article class="agent">
                <strong>${escapeHtml(agent.label)} · ${escapeHtml(agent.status)}</strong>
                <span>${escapeHtml(agent.currentTool || agent.task || "waiting")}</span>
              </article>
            `,
          )
          .join("")}
      </div>
    </details>
  `;
}

function renderExtensionSurfaces(): string {
  const statuses = Object.entries(state.statuses)
    .map(
      ([key, value]) => `
        <div class="extension-status">
          <code>${escapeHtml(key)}</code>
          <span>${escapeHtml(value)}</span>
        </div>
      `,
    )
    .join("");
  const widgets = Object.entries(state.widgets)
    .map(([key, raw]) => {
      const widget = isRecord(raw) ? raw : {};
      const lines = Array.isArray(widget.lines)
        ? widget.lines.map((line) => String(line)).join("\n")
        : pretty(raw);
      return `
        <section class="extension-widget">
          <div class="extension-widget-title">${escapeHtml(key)}</div>
          <pre>${escapeHtml(lines)}</pre>
        </section>
      `;
    })
    .join("");
  return `
    <section class="extension-surfaces" aria-label="OMP extension status">
      ${statuses}
      ${widgets}
    </section>
  `;
}

function renderComposer(): void {
  const blocked =
    state.runtime.transport === "failed" ||
    state.runtime.transport === "exited" ||
    state.runtime.parity === "failed";
  composer.disabled = blocked;
  sendButton.disabled = blocked || !composer.value.trim();
  const streaming = state.runtime.isStreaming;
  steerButton.hidden = !streaming;
  followButton.hidden = !streaming;
  abortButton.hidden = !streaming;
  requireElement("composer-status").textContent = blocked
    ? "Session blocked · inspect logs or open diagnostic terminal"
    : state.runtime.isCompacting
      ? "Compacting context"
      : streaming
        ? "Opus is running · Enter queues · Ctrl+Enter steers"
        : state.runtime.parity === "pending"
          ? "Checking exact runtime parity"
          : `${state.runtime.tools.length} tools · ${state.runtime.queuedMessageCount} queued`;
}

function renderRequest(): void {
  const request = state.requests[0];
  if (!request) {
    requestLayer.hidden = true;
    requestLayer.innerHTML = "";
    return;
  }
  requestLayer.hidden = false;
  requestLayer.innerHTML = renderRequestCard(request);
  const input = requestLayer.querySelector<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("[data-request-value]");
  input?.focus();
  requestLayer
    .querySelector("[data-request-accept]")
    ?.addEventListener("click", () => {
      const value =
        input instanceof HTMLSelectElement ||
        input instanceof HTMLInputElement ||
        input instanceof HTMLTextAreaElement
          ? input.value
          : "";
      respondToRequest(request, true, value);
    });
  requestLayer
    .querySelector("[data-request-reject]")
    ?.addEventListener("click", () =>
      respondToRequest(request, false, ""),
    );
}

function renderRequestCard(request: UiRequest): string {
  const input =
    request.method === "select"
      ? `<select data-request-value>${(request.options ?? [])
          .map((option) => {
            const value =
              typeof option === "string"
                ? option
                : isRecord(option)
                  ? String(option.value ?? option.label ?? "")
                  : String(option ?? "");
            const label =
              isRecord(option) && option.label
                ? String(option.label)
                : value;
            return `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`;
          })
          .join("")}</select>`
      : request.method === "editor"
        ? `<textarea data-request-value>${escapeHtml(request.prefill ?? "")}</textarea>`
        : request.method === "input"
          ? `<input data-request-value value="${escapeAttr(request.prefill ?? "")}" placeholder="${escapeAttr(request.placeholder ?? "")}" />`
          : "";
  return `
    <section class="request-card" role="dialog" aria-modal="true">
      <div class="request-kicker">OMP extension request · ${escapeHtml(request.method)}</div>
      <h2>${escapeHtml(request.title || "Action required")}</h2>
      ${request.message ? `<p>${escapeHtml(request.message)}</p>` : ""}
      ${input}
      <div class="request-actions">
        <button class="button" type="button" data-request-reject>${request.method === "confirm" ? "Reject" : "Cancel"}</button>
        <button class="button primary" type="button" data-request-accept>${request.method === "confirm" ? "Approve" : "Continue"}</button>
      </div>
    </section>
  `;
}

function respondToRequest(
  request: UiRequest,
  accepted: boolean,
  value: string,
): void {
  const response =
    request.method === "confirm"
      ? { type: "extensionUiResponse", id: request.id, confirmed: accepted }
      : accepted
        ? { type: "extensionUiResponse", id: request.id, value }
        : { type: "extensionUiResponse", id: request.id, cancelled: true };
  post(response);
  state = {
    ...state,
    requests: state.requests.filter(
      (candidate) => candidate.id !== request.id,
    ),
  };
  scheduleRender();
}

function renderCommandMenu(): void {
  const commands = filteredCommands();
  if (!composer.value.trim().startsWith("/") || commands.length === 0) {
    commandMenu.hidden = true;
    commandMenu.innerHTML = "";
    commandSelection = 0;
    return;
  }
  commandSelection = Math.min(commandSelection, commands.length - 1);
  commandMenu.hidden = false;
  commandMenu.innerHTML = commands
    .map(
      (command, index) => `
        <button class="command ${index === commandSelection ? "selected" : ""}" type="button" data-command-index="${index}">
          <code>/${escapeHtml(command.name.replace(/^\//, ""))}</code>
          <span>${escapeHtml(command.description || "")}</span>
        </button>
      `,
    )
    .join("");
  for (const button of commandMenu.querySelectorAll<HTMLElement>(
    "[data-command-index]",
  )) {
    button.addEventListener("mousedown", (event: MouseEvent) => {
      event.preventDefault();
      chooseCommand(Number(button.dataset.commandIndex ?? 0));
    });
  }
}

function filteredCommands(): RpcWebviewState["commands"] {
  const query = composer.value.trim().slice(1).toLowerCase();
  return state.commands
    .filter((command) =>
      command.name.replace(/^\//, "").toLowerCase().startsWith(query),
    )
    .slice(0, 12);
}

function chooseCommand(index: number): void {
  const command = filteredCommands()[index];
  if (!command) {
    return;
  }
  composer.value = `/${command.name.replace(/^\//, "")} `;
  vscode.setState({ draft: composer.value });
  commandMenu.hidden = true;
  resizeComposer();
  composer.focus();
}

function submit(type: "prompt" | "steer" | "follow_up"): void {
  const message = composer.value.trim();
  if (!message) {
    return;
  }
  post({ type, message });
  composer.value = "";
  vscode.setState({ draft: "" });
  resizeComposer();
  commandMenu.hidden = true;
  userPinnedScroll = false;
}

function insertText(text: string): void {
  const start = composer.selectionStart;
  const end = composer.selectionEnd;
  composer.value =
    composer.value.slice(0, start) + text + composer.value.slice(end);
  const caret = start + text.length;
  composer.setSelectionRange(caret, caret);
  vscode.setState({ draft: composer.value });
  resizeComposer();
  composer.focus();
}

function resizeComposer(): void {
  composer.style.height = "auto";
  composer.style.height = `${Math.min(Math.max(composer.scrollHeight, 58), 220)}px`;
}

function toggleSearch(open: boolean): void {
  searchBox.hidden = !open;
  if (open) {
    searchInput.focus();
    searchInput.select();
  } else {
    searchInput.value = "";
    composer.focus();
  }
}

function signal(
  status: string,
  label: string,
  value: string,
  extraClass = "",
): string {
  return `
    <span class="signal ${escapeAttr(status)} ${extraClass}">
      <span class="signal-dot"></span>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </span>
  `;
}

function post(message: unknown): void {
  vscode.postMessage(message);
}

function pretty(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > 14_000
      ? `${text.slice(0, 14_000)}\n… truncated in UI; full result remains in OMP session`
      : text;
  } catch {
    return String(value);
  }
}

function summarizeArgs(value: unknown): string {
  if (!isRecord(value)) {
    return pretty(value).replace(/\s+/g, " ").slice(0, 140);
  }
  for (const key of ["path", "command", "query", "pattern", "url"]) {
    if (typeof value[key] === "string") {
      return String(value[key]).slice(0, 180);
    }
  }
  return pretty(value).replace(/\s+/g, " ").slice(0, 140);
}

function extractFilePath(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  for (const key of ["path", "file", "filePath"]) {
    if (typeof value[key] === "string" && value[key]) {
      return value[key];
    }
  }
  return undefined;
}

function normalizePercent(value: number): number {
  const percent = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id}`);
  }
  return element;
}

function requireButton(id: string): HTMLButtonElement {
  const element = requireElement(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`#${id} is not a button`);
  }
  return element;
}

function requireTextArea(id: string): HTMLTextAreaElement {
  const element = requireElement(id);
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error(`#${id} is not a textarea`);
  }
  return element;
}

function requireInput(id: string): HTMLInputElement {
  const element = requireElement(id);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`#${id} is not an input`);
  }
  return element;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function cssEscape(value: string): string {
  return globalThis.CSS?.escape
    ? globalThis.CSS.escape(value)
    : value.replace(/["\\]/g, "\\$&");
}

function numberData(value: string | undefined): number | undefined {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
