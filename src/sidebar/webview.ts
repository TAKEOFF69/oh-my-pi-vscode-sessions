import "./webview.css";

type SidebarSession = {
  id: string;
  label: string;
  cwd: string;
  branch?: string;
  kind: "work" | "readonly" | "loop";
  status: "starting" | "idle" | "running" | "finished" | "failed" | "closed";
  active: boolean;
  live: boolean;
  updatedAt: number;
};

type SidebarState = {
  creating: boolean;
  sessions: SidebarSession[];
};

type VsCodeState = { draft?: string };
type VsCodeApi = {
  postMessage(message: unknown): void;
  getState(): VsCodeState | undefined;
  setState(state: VsCodeState): void;
};

declare global {
  interface Window {
    __OMP_SIDEBAR_FIXTURE__?: unknown[];
  }
}

declare const acquireVsCodeApi: (() => VsCodeApi) | undefined;

const vscode: VsCodeApi =
  typeof acquireVsCodeApi === "function"
    ? acquireVsCodeApi()
    : {
        postMessage(message) {
          window.dispatchEvent(
            new CustomEvent("omp-sidebar-post", { detail: message }),
          );
        },
        getState: () => undefined,
        setState: () => undefined,
      };

let state: SidebarState = { creating: false, sessions: [] };
const renderedRows = new Map<string, HTMLButtonElement>();

const root = requireElement("app");
root.innerHTML = `
  <main class="home">
    <header class="home-header">
      <span>Chats</span>
      <nav aria-label="Chat actions">
        <button id="logs-button" class="icon-button" type="button" title="Show OMP logs" aria-label="Show OMP logs">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4.2a5.8 5.8 0 1 1-5.4 3.7M3.4 4.5v4h4"/><path d="M10 6.5V10l2.4 1.5"/></svg>
        </button>
        <button id="settings-button" class="icon-button" type="button" title="OMP settings" aria-label="OMP settings">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="2.5"/><path d="M10 3.2v1.4M10 15.4v1.4M3.2 10h1.4M15.4 10h1.4M5.2 5.2l1 1M13.8 13.8l1 1M14.8 5.2l-1 1M6.2 13.8l-1 1"/></svg>
        </button>
        <button id="new-chat-button" class="icon-button" type="button" title="New chat" aria-label="New chat">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 15l.7-3.2L13.5 4 16 6.5l-7.8 7.8zM12.7 4.8l2.5 2.5M4 16h12"/></svg>
        </button>
      </nav>
    </header>
    <section class="chat-list" aria-label="OMP chats">
      <div id="session-list"></div>
    </section>
    <div id="empty-mark" class="empty-mark" aria-hidden="true">
      <span>π</span>
    </div>
    <section class="composer-shell">
      <div id="creation-error" class="creation-error" role="status" hidden></div>
      <div class="composer">
        <label class="sr-only" for="composer-input">Start a new OMP chat</label>
        <textarea id="composer-input" rows="2" placeholder="Ask OMP anything" spellcheck="true"></textarea>
        <div class="composer-bar">
          <button id="plus-button" class="plus-button" type="button" title="New chat" aria-label="New chat">+</button>
          <span class="access-label">
            <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2.5l5 2v3.8c0 3.2-2 5.7-5 7.2-3-1.5-5-4-5-7.2V4.5z"/></svg>
            Full access
          </span>
          <span id="creation-status" class="creation-status"></span>
          <span class="model-label" title="Primary driver; GPT-5.6 Sol Extra High advises each primary turn">Opus 5 · Extra High</span>
          <button id="send-button" class="send-button" type="button" title="Start chat" aria-label="Start chat">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 15V5M6 9l4-4 4 4"/></svg>
          </button>
        </div>
      </div>
      <div class="local-context">
        <svg viewBox="0 0 18 18" aria-hidden="true"><rect x="2.5" y="3.5" width="13" height="9" rx="1"/><path d="M6 15h6M9 12.5V15"/></svg>
        <span>Work locally</span><span class="chevron">⌄</span>
      </div>
    </section>
  </main>
`;

const composer = requireTextArea("composer-input");
const sendButton = requireButton("send-button");
const sessionList = requireElement("session-list");
const emptyMark = requireElement("empty-mark");
const creationStatus = requireElement("creation-status");
const creationError = requireElement("creation-error");

composer.value = vscode.getState()?.draft ?? "";
resizeComposer();

window.addEventListener("message", (event: MessageEvent<unknown>) =>
  receiveHostMessage(event.data),
);
window.addEventListener("omp-sidebar-frame", (event) =>
  receiveHostMessage((event as CustomEvent).detail),
);
composer.addEventListener("input", () => {
  vscode.setState({ draft: composer.value });
  resizeComposer();
  renderComposer();
});
composer.addEventListener("keydown", (event) => {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    event.preventDefault();
    submit();
  }
});
sendButton.addEventListener("click", submit);
requireButton("new-chat-button").addEventListener("click", () => newDraft(true));
requireButton("plus-button").addEventListener("click", () => newDraft(true));
requireButton("logs-button").addEventListener("click", () =>
  post({ type: "showLogs" }),
);
requireButton("settings-button").addEventListener("click", () =>
  post({ type: "openSettings" }),
);

post({ type: "ready" });
for (const frame of window.__OMP_SIDEBAR_FIXTURE__ ?? []) {
  receiveHostMessage(frame);
}
render();

function receiveHostMessage(raw: unknown): void {
  if (!isRecord(raw) || typeof raw.type !== "string") return;
  if (raw.type === "state") {
    state = {
      creating: raw.creating === true,
      sessions: Array.isArray(raw.sessions)
        ? raw.sessions.filter(isSidebarSession)
        : [],
    };
    render();
  } else if (raw.type === "focusComposer") {
    newDraft(raw.clear === true);
  } else if (raw.type === "sessionCreated") {
    composer.value = "";
    vscode.setState({ draft: "" });
    creationError.hidden = true;
    resizeComposer();
    renderComposer();
  } else if (raw.type === "sessionCreationFailed") {
    const draft = typeof raw.draft === "string" ? raw.draft : "";
    if (draft) {
      composer.value = draft;
      vscode.setState({ draft });
    }
    creationError.textContent =
      typeof raw.detail === "string" ? raw.detail : "Session was not created.";
    creationError.hidden = false;
    resizeComposer();
    renderComposer();
    composer.focus();
  }
}

function render(): void {
  patchSessionRows();
  emptyMark.hidden = state.sessions.length > 0;
  renderComposer();
}

function patchSessionRows(): void {
  const present = new Set(state.sessions.map((session) => session.id));
  for (const [id, row] of renderedRows) {
    if (!present.has(id)) {
      row.remove();
      renderedRows.delete(id);
    }
  }
  for (const session of state.sessions) {
    let row = renderedRows.get(session.id);
    if (!row) {
      row = document.createElement("button");
      row.type = "button";
      row.className = "chat-row";
      row.dataset.sessionId = session.id;
      row.innerHTML = `<span class="status-dot"></span><span class="chat-label"></span><span class="chat-age"></span>`;
      row.addEventListener("click", () =>
        post({ type: "focusSession", id: session.id }),
      );
      renderedRows.set(session.id, row);
    }
    row.classList.toggle("active", session.active);
    row.classList.toggle("dormant", !session.live);
    row.querySelector<HTMLElement>(".status-dot")!.className =
      `status-dot ${session.status}`;
    row.querySelector<HTMLElement>(".chat-label")!.textContent = session.label;
    row.querySelector<HTMLElement>(".chat-age")!.textContent = relativeAge(
      session.updatedAt,
    );
    row.title = session.live
      ? `${session.label} · ${session.status}`
      : `${session.label} · reopen exact saved worktree`;
    sessionList.append(row);
  }
}

function renderComposer(): void {
  composer.disabled = state.creating;
  sendButton.disabled = state.creating || !composer.value.trim();
  creationStatus.textContent = state.creating ? "Preparing session…" : "";
}

function submit(): void {
  const prompt = composer.value.trim();
  if (!prompt || state.creating) return;
  creationError.hidden = true;
  state = { ...state, creating: true };
  renderComposer();
  post({ type: "createSession", prompt });
}

function newDraft(clear: boolean): void {
  if (clear && !state.creating) {
    composer.value = "";
    vscode.setState({ draft: "" });
    creationError.hidden = true;
    resizeComposer();
    renderComposer();
  }
  composer.focus();
}

function resizeComposer(): void {
  composer.style.height = "auto";
  composer.style.height = `${Math.min(Math.max(composer.scrollHeight, 54), 180)}px`;
}

function relativeAge(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function post(message: unknown): void {
  vscode.postMessage(message);
}

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element;
}

function requireButton(id: string): HTMLButtonElement {
  const element = requireElement(id);
  if (!(element instanceof HTMLButtonElement)) throw new Error(`#${id} is not a button`);
  return element;
}

function requireTextArea(id: string): HTMLTextAreaElement {
  const element = requireElement(id);
  if (!(element instanceof HTMLTextAreaElement)) throw new Error(`#${id} is not a textarea`);
  return element;
}

function isSidebarSession(value: unknown): value is SidebarSession {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.updatedAt === "number" &&
    typeof value.live === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
