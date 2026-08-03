import * as fs from "node:fs";
import * as os from "node:os";
import * as nodePath from "node:path";

import * as vscode from "vscode";

import { extractLoopHandoffAlias } from "../loopHandoff";
import type { SessionLogger } from "../logging";
import type { SessionStatus } from "../sessions/SessionPanel";
import type { SessionHost } from "../sessions/SessionHost";
import { parseRpcWebviewMessage } from "./bridgeMessages";
import { loadRpcMessageHistory } from "./messageHistory";
import {
  formatRpcParityFindings,
  type RpcParityProfile,
  type RpcSessionState,
  validateRpcParity,
} from "./parity";
import { buildRpcHtml } from "./rpcHtml";
import { InitialPromptOwnership } from "./initialPromptOwnership";
import { classifyPreParityFrame } from "./preParity";
import { PromptLifecycle } from "./promptLifecycle";
import { TeardownBarrier } from "./teardownBarrier";
import {
  RpcProcess,
  type RpcFrame,
  type RpcResponse,
} from "./RpcProcess";

export type RpcSessionHostOptions = {
  extensionUri: vscode.Uri;
  webview: vscode.Webview;
  cwd: string;
  branch?: string;
  kind: string;
  executable: string;
  args: readonly string[];
  initialPrompt?: string;
  resumeSessionFile?: string;
  parity?: RpcParityProfile;
  label: string;
  logger: SessionLogger;
  onStatusChange: (status: SessionStatus) => void;
  onTitleChange: (
    title: string,
    source: "session" | "transient",
  ) => boolean;
  onSessionFileChange: (sessionFile: string) => void;
  onLoopHandoff: (alias: string) => void | Promise<void>;
};

export class RpcSessionHost implements SessionHost {
  readonly #extensionUri: vscode.Uri;
  readonly #webview: vscode.Webview;
  readonly #cwd: string;
  readonly #branch: string | undefined;
  readonly #kind: string;
  readonly #executable: string;
  readonly #args: readonly string[];
  readonly #parity: RpcParityProfile | undefined;
  readonly #logger: SessionLogger;
  readonly #onStatusChange: (status: SessionStatus) => void;
  readonly #onTitleChange: (
    title: string,
    source: "session" | "transient",
  ) => boolean;
  readonly #onSessionFileChange: (sessionFile: string) => void;
  readonly #onLoopHandoff: (alias: string) => void | Promise<void>;
  #label: string;
  #rpc: RpcProcess | undefined;
  #disposed = false;
  #webviewReady = false;
  #parityPassed = false;
  #parityFailed = false;
  #sessionFile: string | undefined;
  #resumeSessionFile: string | undefined;
  #startupDiagnostics = "";
  readonly #initialPromptOwnership: InitialPromptOwnership;
  #streaming = false;
  #preParityFrames: RpcFrame[] = [];
  #preParityBytes = 0;
  #promptSequence = 0;
  readonly #handledLoopHandoffs = new Set<string>();
  readonly #promptLifecycle = new PromptLifecycle();
  readonly #teardownBarrier = new TeardownBarrier();
  #restartPromise: Promise<void> | undefined;
  #disposePromise: Promise<void> | undefined;
  #disposables: vscode.Disposable[] = [];

  constructor(options: RpcSessionHostOptions) {
    this.#extensionUri = options.extensionUri;
    this.#webview = options.webview;
    this.#cwd = options.cwd;
    this.#branch = options.branch;
    this.#kind = options.kind;
    this.#executable = options.executable;
    this.#args = options.args;
    this.#initialPromptOwnership = new InitialPromptOwnership(
      options.initialPrompt,
    );
    this.#resumeSessionFile = options.resumeSessionFile;
    this.#parity = options.parity;
    this.#label = options.label;
    this.#logger = options.logger;
    this.#onStatusChange = options.onStatusChange;
    this.#onTitleChange = options.onTitleChange;
    this.#onSessionFileChange = options.onSessionFileChange;
    this.#onLoopHandoff = options.onLoopHandoff;

    this.#webview.options = {
      enableScripts: true,
      localResourceRoots: [options.extensionUri],
    };
    this.#webview.html = buildRpcHtml(this.#webview, this.#extensionUri);
    this.#disposables.push(
      this.#webview.onDidReceiveMessage((raw) =>
        void this.#handleWebviewMessage(raw),
      ),
    );
  }

  send(data: string): void {
    if (!data || this.#disposed) {
      return;
    }
    void this.#post({ type: "insertText", text: data });
  }

  restart(): Promise<void> {
    if (this.#restartPromise) {
      return this.#restartPromise;
    }
    if (this.#disposed) {
      return Promise.resolve();
    }
    this.#restartPromise = this.#restartRpc().finally(() => {
      this.#restartPromise = undefined;
    });
    return this.#restartPromise;
  }

  search(): void {
    void this.#post({ type: "search" });
  }

  focus(): void {
    void this.#post({ type: "focus" });
  }

  setLabel(label: string): void {
    this.#label = label;
    const rpc = this.#rpc;
    if (rpc?.running && this.#parityPassed) {
      void rpc
        .request({ type: "set_session_name", name: label })
        .catch((error) =>
          this.#logger.error(
            `Failed to persist RPC session name "${label}"`,
            error,
          ),
        );
    }
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) {
      return this.#disposePromise;
    }
    this.#disposed = true;
    const rpc = this.#rpc;
    this.#rpc = undefined;
    this.#disposePromise = (async () => {
      if (rpc) {
        void this.#queueTeardown(rpc);
      }
      await this.#teardownBarrier.wait();
      this.#promptLifecycle.clear();
      for (const disposable of this.#disposables) {
        disposable.dispose();
      }
      this.#disposables = [];
    })();
    return this.#disposePromise;
  }

  async #restartRpc(): Promise<void> {
    this.#resumeSessionFile = this.#sessionFile;
    const drafts = this.#promptLifecycle.drain();
    const rpc = this.#rpc;
    this.#rpc = undefined;
    if (rpc) {
      void this.#queueTeardown(rpc);
    }
    await this.#teardownBarrier.wait();
    this.#preParityFrames = [];
    this.#preParityBytes = 0;
    this.#parityPassed = false;
    this.#parityFailed = false;
    this.#streaming = false;
    this.#onStatusChange("starting");
    if (drafts.length > 0) {
      await this.#post({
        type: "restoreDraft",
        text: drafts.join("\n\n"),
      });
    }
    await this.#post({
      type: "transport",
      status: "starting",
      detail: this.#resumeSessionFile
        ? "Restarting and restoring OMP session"
        : "Restarting OMP RPC",
    });
    if (this.#webviewReady && !this.#disposed) {
      await this.#startRpc();
    }
  }

  async #handleWebviewMessage(raw: unknown): Promise<void> {
    const message = parseRpcWebviewMessage(raw);
    if (!message || this.#disposed) {
      return;
    }
    switch (message.type) {
      case "ready":
        this.#webviewReady = true;
        this.#logger.info(`RPC webview ready for "${this.#label}"`);
        await this.#post({
          type: "bootstrap",
          cwd: this.#cwd,
          branch: this.#branch,
          sessionName: this.#label,
          kind: this.#kind,
          advisorLabel:
            this.#parity?.name.startsWith("dzialki-")
              ? "GPT-5.6 Sol · Extra High"
              : "OMP project policy",
          parityRequired: Boolean(this.#parity),
        });
        if (!this.#rpc) {
          await this.#startRpc();
        }
        return;
      case "prompt":
      case "steer":
      case "follow_up":
        await this.#sendPrompt(message.type, message.message);
        return;
      case "abort":
        await this.#request({ type: "abort" });
        return;
      case "extensionUiResponse": {
        const response: Record<string, unknown> = {
          type: "extension_ui_response",
          id: message.id,
        };
        if (message.value !== undefined) {
          response.value = message.value;
        } else if (message.confirmed !== undefined) {
          response.confirmed = message.confirmed;
        } else {
          response.cancelled = message.cancelled ?? true;
        }
        this.#rpc?.send(response);
        await this.#post({ type: "removeRequest", id: message.id });
        return;
      }
      case "openFile":
        await this.#openFile(message.path, message.line, message.col);
        return;
      case "openUrl":
        await this.#openUrl(message.uri);
        return;
      case "showLogs":
        this.#logger.show();
        return;
      case "openDiagnosticTerminal":
        this.#openDiagnosticTerminal();
        return;
      case "showSessions":
        await vscode.commands.executeCommand(
          "workbench.view.extension.oh-my-pi-sessions",
        );
        return;
      case "openSettings":
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@ext:takeoff69.oh-my-pi-vscode-sessions",
        );
        return;
      case "newSession":
        await vscode.commands.executeCommand("ohMyPiSessions.newSession");
        return;
    }
  }

  async #startRpc(): Promise<void> {
    await this.#teardownBarrier.wait();
    if (this.#disposed || this.#rpc) {
      return;
    }
    const startedAt = Date.now();
    this.#startupDiagnostics = "";
    this.#onStatusChange("starting");
    this.#logger.info(
      `Starting RPC "${this.#label}" in ${this.#cwd} with ${this.#executable}`,
    );
    const rpc = new RpcProcess({
      executable: this.#executable,
      args: this.#args,
      cwd: this.#cwd,
      startupTimeoutMs: 45_000,
    });
    this.#rpc = rpc;
    rpc.on("frame", (frame: RpcFrame) => {
      if (this.#rpc !== rpc) {
        return;
      }
      this.#receiveRpcFrame(frame);
    });
    rpc.on("stderr", (text: string) => {
      if (this.#rpc !== rpc) {
        return;
      }
      const cleaned = text.trim();
      if (cleaned) {
        this.#logger.info(`[${this.#label}] ${cleaned}`);
        this.#startupDiagnostics = `${this.#startupDiagnostics}\n${cleaned}`.slice(
          -16_000,
        );
      }
    });
    rpc.on("protocolError", (error: Error) => {
      if (this.#rpc !== rpc) {
        return;
      }
      this.#logger.error(`RPC protocol failure for "${this.#label}"`, error);
      this.#parityFailed = true;
      this.#onStatusChange("failed");
      void this.#post({
        type: "transport",
        status: "failed",
        detail: error.message,
      });
      void this.#restoreInitialPrompt();
    });
    rpc.on(
      "exit",
      ({ code, signal }: { code: number | null; signal: string | null }) => {
        if (this.#rpc !== rpc) {
          return;
        }
        this.#rpc = undefined;
        void this.#restoreInitialPrompt();
        if (this.#disposed || this.#parityFailed) {
          return;
        }
        const failed = code !== 0;
        this.#onStatusChange(failed ? "failed" : "finished");
        void this.#post({
          type: "transport",
          status: failed ? "failed" : "exited",
          detail: failed
            ? startupFailureDetail(code, signal, this.#startupDiagnostics)
            : `OMP RPC exited with code ${code ?? "null"}${
                signal ? ` (${signal})` : ""
              }`,
        });
      },
    );

    try {
      await rpc.start();
      this.#logger.info(
        `RPC transport ready for "${this.#label}": ${Date.now() - startedAt} ms`,
      );
      if (this.#rpc !== rpc || this.#disposed) {
        return;
      }
      if (this.#resumeSessionFile) {
        await rpc.request({
          type: "switch_session",
          sessionPath: this.#resumeSessionFile,
        });
      }
      const stateResponse = await rpc.request({ type: "get_state" });
      const state = responseData(stateResponse);
      const runtimeState: RpcSessionState = {
        ...state,
        cwd: this.#cwd,
      };
      if (
        this.#resumeSessionFile &&
        typeof state.sessionName === "string" &&
        this.#onTitleChange(state.sessionName, "session")
      ) {
        this.#label = state.sessionName;
      }
      this.#sessionFile =
        typeof state.sessionFile === "string"
          ? state.sessionFile
          : this.#sessionFile;
      if (this.#sessionFile) {
        this.#onSessionFileChange(this.#sessionFile);
      }
      if (!this.#validateParity(runtimeState)) {
        await this.#restoreInitialPrompt();
        return;
      }
      this.#logger.info(
        `RPC parity ready for "${this.#label}": ${Date.now() - startedAt} ms`,
      );

      const [history] = await Promise.all([
        state.messageCount === 0
          ? Promise.resolve(emptyHistoryResponse())
          : loadRpcMessageHistory(rpc),
        rpc.request({ type: "get_available_commands" }),
        rpc
          .request({ type: "set_session_name", name: this.#label })
          .catch((error) => {
            this.#logger.error(
              `Failed to persist RPC session name "${this.#label}"`,
              error,
            );
          }),
        rpc
          .request({
            type: "set_subagent_subscription",
            level: "progress",
          })
          .catch((error) => {
            this.#logger.info(
              `Subagent progress unavailable for "${this.#label}": ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }),
      ]);
      if (this.#rpc !== rpc || this.#disposed) {
        return;
      }
      this.#handleRpcFrame(history);
      await this.#post({ type: "rpc", frame: history });
      this.#onStatusChange("idle");
      await this.#post({ type: "transport", status: "ready" });
      this.#logger.info(
        `RPC session ready for "${this.#label}": ${Date.now() - startedAt} ms`,
      );
      const restored = Boolean(this.#resumeSessionFile);
      this.#resumeSessionFile = undefined;
      if (!restored) {
        const initialPrompt = this.#initialPromptOwnership.claimForDelivery();
        if (initialPrompt) {
          await this.#sendPrompt("prompt", initialPrompt);
        }
      }
    } catch (error) {
      if (this.#rpc !== rpc || this.#disposed) {
        return;
      }
      const failure = error instanceof Error ? error : new Error(String(error));
      this.#logger.error(`Failed to start RPC "${this.#label}"`, failure);
      this.#onStatusChange("failed");
      await this.#post({
        type: "transport",
        status: "failed",
        detail: startupFailureDetail(
          null,
          null,
          `${failure.message}\n${this.#startupDiagnostics}`,
        ),
      });
      await this.#restoreInitialPrompt();
      this.#rpc = undefined;
      await this.#queueTeardown(rpc);
    }
  }

  async #restoreInitialPrompt(): Promise<void> {
    const prompt = this.#initialPromptOwnership.claimForRestore();
    if (!prompt || this.#disposed) return;
    await this.#post({ type: "restoreDraft", text: prompt });
  }

  #validateParity(state: RpcSessionState): boolean {
    const findings = this.#parity
      ? validateRpcParity(state, this.#parity)
      : [];
    if (findings.length === 0) {
      this.#parityPassed = true;
      if (this.#parity) {
        this.#logger.info(
          `RPC parity passed for "${this.#label}" (${this.#parity.name})`,
        );
      }
      void this.#post({ type: "parity", ok: true });
      this.#flushPreParityFrames();
      return true;
    }
    const detail = formatRpcParityFindings(findings);
    this.#parityFailed = true;
    this.#parityPassed = false;
    this.#logger.error(`RPC parity blocked "${this.#label}": ${detail}`);
    this.#onStatusChange("failed");
    void this.#post({ type: "parity", ok: false, detail });
    this.#preParityFrames = [];
    this.#preParityBytes = 0;
    const rpc = this.#rpc;
    this.#rpc = undefined;
    if (rpc) {
      void this.#queueTeardown(rpc).catch((error) => {
        this.#logger.error(
          `Failed to reap parity-blocked RPC "${this.#label}"`,
          error,
        );
      });
    }
    return false;
  }

  #receiveRpcFrame(frame: RpcFrame): void {
    if (!this.#parityPassed) {
      if (classifyPreParityFrame(frame) === "reject-ui") {
        this.#rejectPreParityUiRequest(frame);
        return;
      }
      const encodedBytes = Buffer.byteLength(
        JSON.stringify(frame),
        "utf8",
      );
      this.#preParityBytes += encodedBytes;
      this.#preParityFrames.push(frame);
      if (
        this.#preParityFrames.length > 512 ||
        this.#preParityBytes > 2 * 1024 * 1024
      ) {
        this.#parityFailed = true;
        this.#onStatusChange("failed");
        void this.#post({
          type: "parity",
          ok: false,
          detail: "pre-parity RPC frame budget exceeded",
        });
        const rpc = this.#rpc;
        this.#rpc = undefined;
        if (rpc) {
          void this.#queueTeardown(rpc).catch((error) => {
            this.#logger.error(
              `Failed to reap budget-blocked RPC "${this.#label}"`,
              error,
            );
          });
        }
        void this.#restoreInitialPrompt();
      }
      return;
    }
    this.#handleRpcFrame(frame);
    void this.#post({ type: "rpc", frame });
  }

  #flushPreParityFrames(): void {
    const buffered = this.#preParityFrames;
    this.#preParityFrames = [];
    this.#preParityBytes = 0;
    for (const frame of buffered) {
      this.#handleRpcFrame(frame);
      void this.#post({ type: "rpc", frame });
    }
  }

  #rejectPreParityUiRequest(frame: RpcFrame): void {
    const id = typeof frame.id === "string" ? frame.id : "";
    if (id && this.#rpc?.running) {
      this.#rpc.send({
        type: "extension_ui_response",
        id,
        cancelled: true,
      });
    }
    this.#logger.info(
      `Rejected pre-parity extension UI request for "${this.#label}"`,
    );
  }

  #queueTeardown(rpc: RpcProcess): Promise<void> {
    return this.#teardownBarrier.enqueue(() => rpc.dispose());
  }

  #handleRpcFrame(frame: RpcFrame): void {
    switch (frame.type) {
      case "agent_start":
      case "turn_start":
        this.#streaming = true;
        this.#onStatusChange("running");
        break;
      case "agent_end":
        this.#promptLifecycle.agentEnded(frame.isTerminal !== false);
        if (frame.isTerminal !== false) {
          this.#streaming = false;
          this.#onStatusChange("idle");
        }
        break;
      case "prompt_result":
        if (typeof frame.id === "string") {
          this.#promptLifecycle.complete(frame.id);
        }
        if (frame.agentInvoked === false) {
          this.#streaming = false;
          this.#onStatusChange("idle");
        }
        break;
      case "response":
        if (
          frame.success === false &&
          typeof frame.id === "string"
        ) {
          const draft = this.#promptLifecycle.fail(frame.id);
          if (draft !== undefined) {
            void this.#post({ type: "restoreDraft", text: draft });
          }
        }
        break;
      case "extension_ui_request":
        void this.#handleExtensionUiRequest(frame);
        break;
      case "tool_execution_end":
        this.#handleLoopHandoff(frame);
        break;
      case "session_info_update": {
        const title =
          typeof frame.title === "string" ? frame.title.trim() : "";
        if (title && this.#onTitleChange(title, "session")) {
          this.#label = title;
        }
        break;
      }
    }
  }

  #handleLoopHandoff(frame: RpcFrame): void {
    const alias = extractLoopHandoffAlias(frame);
    const toolCallId =
      typeof frame.toolCallId === "string" ? frame.toolCallId : "";
    if (
      !alias ||
      !toolCallId ||
      this.#kind !== "work" ||
      this.#parity?.name !== "dzialki-work" ||
      !this.#parityPassed ||
      this.#handledLoopHandoffs.has(toolCallId)
    ) {
      return;
    }
    this.#handledLoopHandoffs.add(toolCallId);
    this.#logger.info(
      `Validated Loop handoff "${alias}" from "${this.#label}"`,
    );
    void Promise.resolve(this.#onLoopHandoff(alias)).catch((error) => {
      this.#logger.error(`Loop handoff "${alias}" failed`, error);
    });
  }

  async #handleExtensionUiRequest(frame: RpcFrame): Promise<void> {
    const method = typeof frame.method === "string" ? frame.method : "";
    const id = typeof frame.id === "string" ? frame.id : "";
    if (method === "open_url") {
      const url =
        typeof frame.url === "string"
          ? frame.url
          : typeof frame.uri === "string"
            ? frame.uri
            : "";
      const opened = url ? await this.#openUrl(url) : false;
      if (id && this.#rpc?.running) {
        this.#rpc.send({
          type: "extension_ui_response",
          id,
          confirmed: opened,
        });
      }
    } else if (method === "setTitle") {
      const title =
        typeof frame.title === "string" ? frame.title.trim() : "";
      if (title && this.#onTitleChange(title, "transient")) {
        this.#label = title;
      }
    } else if (
      method === "set_editor_text" ||
      method === "setEditorText"
    ) {
      const text =
        typeof frame.text === "string"
          ? frame.text
          : typeof frame.value === "string"
            ? frame.value
            : "";
      await this.#post({ type: "setComposer", text });
    }
  }

  async #sendPrompt(
    type: "prompt" | "steer" | "follow_up",
    message: string,
  ): Promise<void> {
    if (!this.#parityPassed || this.#parityFailed) {
      await this.#post({ type: "restoreDraft", text: message });
      await vscode.window.showErrorMessage(
        "OMP Sessions: prompt blocked until exact RPC parity passes.",
      );
      return;
    }
    const rpc = this.#rpc;
    if (!rpc?.running) {
      await this.#post({ type: "restoreDraft", text: message });
      await vscode.window.showErrorMessage(
        "OMP Sessions: RPC runtime is not running.",
      );
      return;
    }
    const id = `vscode_prompt_${++this.#promptSequence}`;
    this.#promptLifecycle.begin(id, message);
    const command =
      type === "prompt"
        ? {
            type: "prompt",
            id,
            message,
            ...(this.#streaming
              ? { streamingBehavior: "followUp" }
              : {}),
          }
        : { type, id, message };
    try {
      await rpc.request(command);
    } catch (error) {
      const draft = this.#promptLifecycle.fail(id);
      if (draft !== undefined) {
        await this.#post({ type: "restoreDraft", text: draft });
      }
      const failure = error instanceof Error ? error.message : String(error);
      this.#logger.error(
        `RPC ${type} failed for "${this.#label}"`,
        error,
      );
      await vscode.window.showErrorMessage(`OMP Sessions: ${failure}`);
    }
  }

  async #request(
    command: Record<string, unknown> & { type: string },
  ): Promise<RpcResponse | undefined> {
    const rpc = this.#rpc;
    if (!rpc?.running) {
      await vscode.window.showErrorMessage(
        "OMP Sessions: RPC runtime is not running.",
      );
      return undefined;
    }
    try {
      return await rpc.request(command);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.#logger.error(
        `RPC ${command.type} failed for "${this.#label}"`,
        error,
      );
      await vscode.window.showErrorMessage(`OMP Sessions: ${message}`);
      return undefined;
    }
  }

  async #openUrl(raw: string): Promise<boolean> {
    try {
      const uri = vscode.Uri.parse(raw);
      if (!["https", "http", "mailto"].includes(uri.scheme)) {
        throw new Error(`unsupported URL scheme ${uri.scheme}`);
      }
      return await vscode.env.openExternal(uri);
    } catch (error) {
      await vscode.window.showWarningMessage(
        `OMP Sessions: cannot open URL — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  async #openFile(
    filePath: string,
    line?: number,
    col?: number,
  ): Promise<void> {
    const resolved = this.#resolveFilePath(filePath);
    if (!resolved) {
      await vscode.window.showWarningMessage(
        `OMP Sessions: cannot find ${filePath} from ${this.#cwd}`,
      );
      return;
    }
    try {
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(resolved),
      );
      const editor = await vscode.window.showTextDocument(document);
      if (line !== undefined && line >= 1) {
        const targetLine = Math.min(line - 1, document.lineCount - 1);
        const targetColumn = col !== undefined && col >= 1 ? col - 1 : 0;
        const position = new vscode.Position(targetLine, targetColumn);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(
          new vscode.Range(position, position),
          vscode.TextEditorRevealType.InCenter,
        );
      }
    } catch (error) {
      await vscode.window.showErrorMessage(
        `OMP Sessions: cannot open ${filePath} — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  #openDiagnosticTerminal(): void {
    const terminal = vscode.window.createTerminal({
      name: `OMP diagnostics · ${this.#label}`,
      cwd: this.#cwd,
      message:
        "Diagnostic shell only. RPC session remains sole writer; run auth/config/read-only diagnostics here.",
    });
    terminal.show();
  }

  #resolveFilePath(filePath: string): string | undefined {
    const expanded = filePath.startsWith("~")
      ? nodePath.join(os.homedir(), filePath.slice(1))
      : filePath;
    const candidates = [
      nodePath.isAbsolute(expanded)
        ? expanded
        : nodePath.resolve(this.#cwd, expanded),
      ...(vscode.workspace.workspaceFolders ?? []).map((folder) =>
        nodePath.resolve(folder.uri.fsPath, expanded),
      ),
    ];
    return candidates.find((candidate) => {
      try {
        return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
      } catch {
        return false;
      }
    });
  }

  #post(message: unknown): Thenable<boolean> {
    return this.#webview.postMessage(message);
  }
}

function responseData(response: RpcResponse): Record<string, unknown> {
  return isRecord(response.data) ? response.data : {};
}

function emptyHistoryResponse(): RpcResponse {
  return {
    type: "response",
    id: "vscode_message_history",
    command: "get_messages",
    success: true,
    data: { messages: [] },
  };
}

function startupFailureDetail(
  code: number | null,
  signal: string | null,
  diagnostics: string,
): string {
  const lines = diagnostics
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const blockIndex = lines.findLastIndex((line) =>
    /\[(?:BLOCK|FAIL)\]|preflight blocked|error:/i.test(line),
  );
  const selected =
    blockIndex >= 0
      ? lines.slice(blockIndex, blockIndex + 3)
      : lines.slice(-3);
  const cause = selected.join(" ").slice(0, 900);
  const exit =
    code === null && !signal
      ? "OMP startup failed"
      : `OMP RPC exited with code ${code ?? "null"}${
          signal ? ` (${signal})` : ""
        }`;
  return cause
    ? `${exit}. ${cause} Full diagnostics are in OMP Sessions logs.`
    : `${exit}. Open OMP Sessions logs for diagnostics.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
