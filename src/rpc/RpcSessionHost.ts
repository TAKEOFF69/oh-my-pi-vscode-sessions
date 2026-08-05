import * as vscode from "vscode";

import { extractLoopHandoffAlias } from "../loopHandoff";
import type { SessionLogger } from "../logging";
import type { SessionStatus } from "../sessions/SessionPanel";
import type { SessionHost } from "../sessions/SessionHost";
import { resolveSessionFile } from "../sessionFileResolver";
import {
  parsePromptImages,
  type PromptDraft,
  type PromptImage,
} from "../promptImages";
import { parseRpcWebviewMessage } from "./bridgeMessages";
import { loadRpcMessageHistory } from "./messageHistory";
import {
  formatRpcParityFindings,
  type RpcParityProfile,
  type RpcSessionState,
  validateRpcParity,
  validateRpcRuntimeConfigFrame,
} from "./parity";
import { InitialPromptOwnership } from "./initialPromptOwnership";
import { ambientMcpMounts } from "./mcpMountGate";
import { FINAL_ANSWER_QUIET_MS, isTerminalAssistantMessageEnd } from "./turnWatchdog";
import { advisorStatusMatches, EXPECTED_ADVISOR_SELECTOR } from "./advisorStatus";
import {
  classifyPreParityFrame,
  enforceToolApprovalTripwire,
} from "./preParity";
import { PromptLifecycle } from "./promptLifecycle";
import { buildRpcPromptCommand } from "./promptCommand";
import { tagSurfaceMessage } from "../sidebar/surfaceRouting";
import { TeardownBarrier } from "./teardownBarrier";
import {
  RpcProcess,
  type RpcFrame,
  type RpcResponse,
} from "./RpcProcess";
import { RpcViewReplayBuffer } from "./RpcViewReplayBuffer";

export type RpcSessionHostOptions = {
  cwd: string;
  branch?: string;
  kind: string;
  executable: string;
  args: readonly string[];
  initialPrompt?: string;
  initialImages?: readonly PromptImage[];
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
  onInitialPromptSettled?: (accepted: boolean) => void | Promise<void>;
  onFirstPromptAccepted?: () => void | Promise<void>;
  onFirstPromptStarted?: () => void | Promise<void>;
  onFirstPromptRejected?: () => void | Promise<void>;
  env?: NodeJS.ProcessEnv;
};

export class RpcSessionHost implements SessionHost {
  #webview: vscode.Webview | undefined;
  #surfaceToken = "";
  #attachmentRevision = 0;
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
  readonly #onInitialPromptSettled: (accepted: boolean) => void | Promise<void>;
  readonly #onFirstPromptAccepted: () => void | Promise<void>;
  readonly #onFirstPromptStarted: () => void | Promise<void>;
  readonly #onFirstPromptRejected: () => void | Promise<void>;
  readonly #env: NodeJS.ProcessEnv | undefined;
  #label: string;
  #rpc: RpcProcess | undefined;
  #disposed = false;
  #webviewReady = false;
  #parityPassed = false;
  #parityFailed = false;
  #sessionFile: string | undefined;
  #resumeSessionFile: string | undefined;
  #historySnapshot: RpcResponse | undefined;
  #commandsSnapshot: RpcResponse | undefined;
  #activeTurnFrames: RpcFrame[] = [];
  #activeTurnBytes = 0;
  #activeTurnOverflow = false;
  readonly #viewReplay = new RpcViewReplayBuffer<RpcFrame>();
  #viewDraft = "";
  #viewImages: PromptImage[] = [];
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
  #initialPromptSettled = false;
  #firstPromptAccepted = false;
  #firstPromptReserved = false;
  #firstPromptTransition: Promise<void> = Promise.resolve();
  #turnWatchdog: NodeJS.Timeout | undefined;
  #terminalAnswerPending = false;
  #watchdogRecovering = false;
  #advisorProbeActive = false;
  #advisorProbeOutput: string[] = [];
  #advisorProbePromise: Promise<boolean> | undefined;
  #advisorProbeTimer: NodeJS.Timeout | undefined;
  #rpcGeneration = 0;
  #advisorVerifiedAt: number | undefined;

  constructor(options: RpcSessionHostOptions) {
    this.#cwd = options.cwd;
    this.#branch = options.branch;
    this.#kind = options.kind;
    this.#executable = options.executable;
    this.#args = options.args;
    this.#initialPromptOwnership = new InitialPromptOwnership(
      options.initialPrompt,
      options.initialImages,
    );
    this.#resumeSessionFile = options.resumeSessionFile;
    this.#parity = options.parity;
    this.#label = options.label;
    this.#logger = options.logger;
    this.#onStatusChange = options.onStatusChange;
    this.#onTitleChange = options.onTitleChange;
    this.#onSessionFileChange = options.onSessionFileChange;
    this.#onLoopHandoff = options.onLoopHandoff;
    this.#onInitialPromptSettled = options.onInitialPromptSettled ?? (() => undefined);
    this.#onFirstPromptAccepted = options.onFirstPromptAccepted ?? (() => undefined);
    this.#onFirstPromptStarted = options.onFirstPromptStarted ?? (() => undefined);
    this.#onFirstPromptRejected = options.onFirstPromptRejected ?? (() => undefined);
    this.#env = options.env;
  }

  attachWebview(webview: vscode.Webview, surfaceToken: string): void {
    if (this.#disposed) return;
    this.#webview = webview;
    this.#surfaceToken = surfaceToken;
    this.#attachmentRevision += 1;
    this.#webviewReady = false;
    this.#cancelRehydration();
  }

  detachWebview(webview?: vscode.Webview): void {
    if (webview && this.#webview !== webview) return;
    this.#webview = undefined;
    this.#surfaceToken = "";
    this.#attachmentRevision += 1;
    this.#webviewReady = false;
    this.#cancelRehydration();
  }

  async handleWebviewMessage(raw: unknown): Promise<void> {
    await this.#handleWebviewMessage(raw);
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
    this.#rpcGeneration += 1;
    this.#clearAdvisorProbeTimer();
    this.#advisorVerifiedAt = undefined;
    this.#clearTurnWatchdog();
    void this.#settleInitialPrompt(false);
    const rpc = this.#rpc;
    this.#rpc = undefined;
    this.#disposePromise = (async () => {
      if (rpc) {
        void this.#queueTeardown(rpc);
      }
      await this.#teardownBarrier.wait();
      await this.#releaseFirstPromptReservation();
      await this.#advisorProbePromise?.catch(() => false);
      this.#promptLifecycle.clear();
      for (const disposable of this.#disposables) {
        disposable.dispose();
      }
      this.#disposables = [];
    })();
    return this.#disposePromise;
  }

  async #restartRpc(): Promise<void> {
    this.#rpcGeneration += 1;
    this.#clearAdvisorProbeTimer();
    this.#advisorVerifiedAt = undefined;
    this.#resumeSessionFile = this.#sessionFile;
    const drafts = this.#promptLifecycle.drain();
    const rpc = this.#rpc;
    this.#rpc = undefined;
    if (rpc) {
      void this.#queueTeardown(rpc);
    }
    await this.#teardownBarrier.wait();
    await this.#releaseFirstPromptReservation();
    await this.#advisorProbePromise?.catch(() => false);
    this.#preParityFrames = [];
    this.#preParityBytes = 0;
    this.#parityPassed = false;
    this.#parityFailed = false;
    this.#streaming = false;
    this.#clearTurnWatchdog();
    this.#historySnapshot = undefined;
    this.#commandsSnapshot = undefined;
    this.#activeTurnFrames = [];
    this.#activeTurnBytes = 0;
    this.#activeTurnOverflow = false;
    this.#viewReplay.clearPendingUiRequests();
    this.#cancelRehydration();
    this.#onStatusChange("starting");
    if (drafts.length > 0) {
      await this.#restoreDrafts(drafts);
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
      {
        const attachmentRevision = this.#attachmentRevision;
        this.#webviewReady = true;
        this.#logger.info(`RPC webview ready for "${this.#label}"`);
        await this.#postBootstrap(attachmentRevision);
        if (!this.#rpc) {
          await this.#startRpc();
        } else {
          await this.#rehydrateWebview(attachmentRevision);
        }
        await this.#post(
          {
            type: "setComposer",
            text: this.#viewDraft,
            images: this.#viewImages,
          },
          attachmentRevision,
        );
        return;
      }
      case "draftChanged":
        this.#viewDraft = message.draft;
        return;
      case "attachmentsChanged":
        this.#viewImages = message.images;
        return;
      case "prompt":
      case "steer":
      case "follow_up":
        this.#viewDraft = "";
        this.#viewImages = [];
        await this.#sendPrompt(
          message.type,
          message.message,
          message.images,
        );
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
        this.#viewReplay.resolveUiRequest(message.id);
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
    const generation = ++this.#rpcGeneration;
    this.#clearAdvisorProbeTimer();
    this.#advisorVerifiedAt = undefined;
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
      emitTitleEvents: true,
      env: this.#env,
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
      this.#clearAdvisorProbeTimer();
      this.#advisorVerifiedAt = undefined;
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
        if (generation !== this.#rpcGeneration) return;
        this.#rpc = undefined;
        this.#clearAdvisorProbeTimer();
        this.#advisorVerifiedAt = undefined;
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
      if (this.#parity) {
        await rpc.request({
          type: "set_model",
          provider: this.#parity.provider,
          modelId: this.#parity.modelId,
        });
        await rpc.request({
          type: "set_thinking_level",
          level: this.#parity.thinkingLevel,
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
      if (!(await this.#verifyAdvisorRuntime(rpc, generation))) return;

      const [history, commands] = await Promise.all([
        state.messageCount === 0
          ? Promise.resolve(emptyHistoryResponse())
          : loadRpcMessageHistory(rpc),
        rpc.request({ type: "get_available_commands" }),
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
      if (!this.#validateAmbientMcpMounts(history)) return;
      this.#historySnapshot = history;
      this.#commandsSnapshot = commands;
      await this.#post({ type: "rpc", frame: stateResponse });
      this.#handleRpcFrame(history);
      await this.#post({ type: "rpc", frame: history });
      await this.#post({ type: "rpc", frame: commands });
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
          const accepted = await this.#sendPrompt(
            "prompt",
            initialPrompt.message,
            initialPrompt.images,
          );
          await this.#settleInitialPrompt(accepted);
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
    await this.#post({
      type: "restoreDraft",
      text: prompt.message,
      images: prompt.images,
    });
    await this.#settleInitialPrompt(false);
  }

  showHostNotice(detail: string): void {
    void this.#post({
      type: "rpc",
      frame: {
        type: "notice",
        level: "error",
        source: "Extension reload required",
        message: detail,
      },
    });
  }

  async #settleInitialPrompt(accepted: boolean): Promise<void> {
    if (this.#initialPromptSettled) return;
    this.#initialPromptSettled = true;
    await this.#onInitialPromptSettled(accepted);
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
      return this.#flushPreParityFrames();
    }
    return this.#blockParity(formatRpcParityFindings(findings));
  }

  #validateRuntimeConfig(frame: RpcFrame): boolean {
    if (!this.#parity) return true;
    const findings = validateRpcRuntimeConfigFrame(frame, this.#parity);
    if (findings.length === 0) return true;
    return this.#blockParity(
      `Runtime model lock changed after startup.\n${formatRpcParityFindings(findings)}`,
    );
  }

  #validateAmbientMcpMounts(frame: RpcFrame): boolean {
    if (!this.#parity?.name.startsWith("dzialki-")) return true;
    const mounts = ambientMcpMounts(frame);
    return mounts.length === 0
      ? true
      : this.#blockParity(
          `Ambient MCP devices mounted despite project isolation: ${mounts.join(", ")}`,
        );
  }

  #blockParity(detail: string): false {
    this.#clearAdvisorProbeTimer();
    this.#advisorVerifiedAt = undefined;
    this.#parityFailed = true;
    this.#parityPassed = false;
    this.#logger.error(`RPC parity blocked "${this.#label}": ${detail}`);
    this.#onStatusChange("failed");
    void this.#post({ type: "parity", ok: false, detail });
    this.#preParityFrames = [];
    this.#clearTurnWatchdog();
    this.#preParityBytes = 0;
    const drafts = this.#promptLifecycle.drain();
    if (drafts.length > 0) {
      void this.#restoreDrafts(drafts);
    }
    void this.#restoreInitialPrompt();
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
    if (!this.#validateAmbientMcpMounts(frame)) return;
    if (this.#advisorProbeActive && frame.type === "command_output") {
      const text = typeof frame.text === "string" ? frame.text : "";
      if (text) this.#advisorProbeOutput.push(text);
      return;
    }
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
    if (enforceToolApprovalTripwire(this.#parity?.name, frame, {
      cancel: (request) =>
        this.#cancelExtensionUiRequest(
          request,
          "unexpected native tool approval",
        ),
      block: (detail) => {
        this.#blockParity(detail);
      },
    })) {
      return;
    }
    if (!this.#validateRuntimeConfig(frame)) return;
    this.#observeTurnWatchdog(frame);
    this.#observeRpcFrame(frame);
    this.#handleRpcFrame(frame);
    this.#deliverRpcFrame(frame);
    if (frame.type === "agent_end" && frame.isTerminal !== false) {
      this.#scheduleAdvisorProbe();
    }
  }

  #flushPreParityFrames(): boolean {
    const buffered = this.#preParityFrames;
    this.#preParityFrames = [];
    this.#preParityBytes = 0;
    for (const frame of buffered) {
      // Startup set_model/set_thinking_level responses are intentionally
      // buffered and may omit the resulting state in OMP 17.1.3. The full
      // get_state snapshot was validated immediately before this flush.
      if (!this.#validateAmbientMcpMounts(frame)) return false;
      this.#observeTurnWatchdog(frame);
      this.#observeRpcFrame(frame);
      this.#handleRpcFrame(frame);
      this.#deliverRpcFrame(frame);
    }
    return true;
  }

  #rejectPreParityUiRequest(frame: RpcFrame): void {
    this.#cancelExtensionUiRequest(frame, "pre-parity extension UI request");
  }

  #cancelExtensionUiRequest(frame: RpcFrame, reason: string): void {
    const id = typeof frame.id === "string" ? frame.id : "";
    if (id && this.#rpc?.running) {
      this.#rpc.send({
        type: "extension_ui_response",
        id,
        cancelled: true,
      });
    }
    this.#logger.info(
      `Cancelled ${reason} for "${this.#label}"`,
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
            void this.#post({
              type: "restoreDraft",
              text: draft.message,
              images: draft.images,
            });
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
    images: readonly PromptImage[] = [],
  ): Promise<boolean> {
    if (!this.#parityPassed || this.#parityFailed) {
      await this.#post({ type: "restoreDraft", text: message, images });
      await vscode.window.showErrorMessage(
        "OMP Sessions: prompt blocked until exact RPC parity passes.",
      );
      return false;
    }
    const rpc = this.#rpc;
    if (!rpc?.running) {
      await this.#post({ type: "restoreDraft", text: message, images });
      await vscode.window.showErrorMessage(
        "OMP Sessions: RPC runtime is not running.",
      );
      return false;
    }
    this.#clearAdvisorProbeTimer();
    const advisorProbe = this.#advisorProbePromise;
    if (advisorProbe && !(await advisorProbe)) {
      await this.#post({ type: "restoreDraft", text: message, images });
      return false;
    }
    if (this.#rpc !== rpc || !rpc.running || !this.#parityPassed) {
      await this.#post({ type: "restoreDraft", text: message, images });
      return false;
    }
    const generation = this.#rpcGeneration;
    const id = `vscode_prompt_${++this.#promptSequence}`;
    let reservedByThisPrompt = false;
    if (!this.#firstPromptAccepted) {
      try {
        reservedByThisPrompt = await this.#reserveFirstPrompt();
      } catch (error) {
        await this.#post({ type: "restoreDraft", text: message, images });
        this.#logger.error(`Could not reserve first prompt for "${this.#label}"`, error);
        return false;
      }
    }
    if (
      this.#disposed ||
      this.#rpc !== rpc ||
      !rpc.running ||
      generation !== this.#rpcGeneration
    ) {
      if (reservedByThisPrompt) await this.#releaseFirstPromptReservation();
      await this.#post({ type: "restoreDraft", text: message, images });
      return false;
    }
    this.#promptLifecycle.begin(id, message, images);
    const command = buildRpcPromptCommand(
      type,
      id,
      message,
      images,
      this.#streaming,
    );
    try {
      await rpc.request(command);
      const accepted = await this.#markFirstPromptAccepted();
      if (!accepted) {
        const draft = this.#promptLifecycle.fail(id);
        if (draft !== undefined) {
          await this.#post({
            type: "restoreDraft",
            text: draft.message,
            images: draft.images,
          });
        }
      }
      return accepted;
    } catch (error) {
      if (reservedByThisPrompt && !this.#firstPromptAccepted) {
        await this.#releaseFirstPromptReservation();
      }
      const draft = this.#promptLifecycle.fail(id);
      if (draft !== undefined) {
        await this.#post({
          type: "restoreDraft",
          text: draft.message,
          images: draft.images,
        });
      }
      const failure = error instanceof Error ? error.message : String(error);
      this.#logger.error(
        `RPC ${type} failed for "${this.#label}"`,
        error,
      );
      await vscode.window.showErrorMessage(`OMP Sessions: ${failure}`);
      return false;
    }
  }

  async #verifyAdvisorRuntime(
    rpc: RpcProcess,
    generation = this.#rpcGeneration,
    announce = true,
  ): Promise<boolean> {
    if (!this.#parity?.name.startsWith("dzialki-")) return true;
    if (this.#advisorProbePromise) return this.#advisorProbePromise;
    const probe = this.#runAdvisorProbe(rpc, generation, announce);
    this.#advisorProbePromise = probe;
    try {
      return await probe;
    } finally {
      if (this.#advisorProbePromise === probe) {
        this.#advisorProbePromise = undefined;
      }
    }
  }

  async #runAdvisorProbe(
    rpc: RpcProcess,
    generation: number,
    announce: boolean,
  ): Promise<boolean> {
    if (
      this.#disposed ||
      this.#rpc !== rpc ||
      generation !== this.#rpcGeneration ||
      !rpc.running
    ) {
      return false;
    }
    this.#advisorProbeActive = true;
    this.#advisorProbeOutput = [];
    try {
      const response = await rpc.request(
        { type: "prompt", message: "/advisor status" },
        15_000,
      );
      const output = this.#advisorProbeOutput.join("\n");
      if (
        this.#disposed ||
        this.#rpc !== rpc ||
        generation !== this.#rpcGeneration
      ) {
        return false;
      }
      const localOnly = !isRecord(response.data) || response.data.agentInvoked !== true;
      if (!localOnly || !advisorStatusMatches(output)) {
        return this.#blockParity(
          `Live advisor check failed; expected ${EXPECTED_ADVISOR_SELECTOR}.`,
        );
      }
      this.#advisorVerifiedAt = Date.now();
      if (announce) await this.#postBootstrap(this.#attachmentRevision);
      this.#logger.info(
        `Live advisor verified for "${this.#label}" (${EXPECTED_ADVISOR_SELECTOR})`,
      );
      return true;
    } catch (error) {
      if (
        this.#disposed ||
        this.#rpc !== rpc ||
        generation !== this.#rpcGeneration
      ) {
        return false;
      }
      this.#logger.error(`Live advisor check failed for "${this.#label}"`, error);
      return this.#blockParity(
        `Live advisor check failed; expected ${EXPECTED_ADVISOR_SELECTOR}.`,
      );
    } finally {
      this.#advisorProbeActive = false;
      this.#advisorProbeOutput = [];
    }
  }

  #scheduleAdvisorProbe(): void {
    this.#clearAdvisorProbeTimer();
    const rpc = this.#rpc;
    const generation = this.#rpcGeneration;
    if (!rpc?.running || !this.#parityPassed || this.#disposed) return;
    this.#advisorProbeTimer = setTimeout(() => {
      this.#advisorProbeTimer = undefined;
      if (
        this.#rpc !== rpc ||
        generation !== this.#rpcGeneration ||
        !rpc.running ||
        this.#disposed ||
        this.#streaming ||
        !this.#parityPassed
      ) {
        return;
      }
      void this.#verifyAdvisorRuntime(rpc, generation, false);
    }, 150);
  }

  #clearAdvisorProbeTimer(): void {
    if (!this.#advisorProbeTimer) return;
    clearTimeout(this.#advisorProbeTimer);
    this.#advisorProbeTimer = undefined;
  }

  async #reserveFirstPrompt(): Promise<boolean> {
    let reserved = false;
    await this.#queueFirstPromptTransition(async () => {
      if (
        this.#disposed ||
        this.#firstPromptAccepted ||
        this.#firstPromptReserved
      ) return;
      await this.#onFirstPromptStarted();
      this.#firstPromptReserved = true;
      reserved = true;
    });
    return reserved;
  }

  async #markFirstPromptAccepted(): Promise<boolean> {
    let accepted = false;
    await this.#queueFirstPromptTransition(async () => {
      if (this.#firstPromptAccepted) {
        accepted = true;
        return;
      }
      if (!this.#firstPromptReserved) return;
      await this.#onFirstPromptAccepted();
      this.#firstPromptAccepted = true;
      this.#firstPromptReserved = false;
      accepted = true;
    });
    return accepted;
  }

  async #releaseFirstPromptReservation(): Promise<void> {
    await this.#queueFirstPromptTransition(async () => {
      if (!this.#firstPromptReserved || this.#firstPromptAccepted) return;
      this.#firstPromptReserved = false;
      try {
        await this.#onFirstPromptRejected();
      } catch (error) {
        this.#logger.error(
          `Could not release first prompt reservation for "${this.#label}"`,
          error,
        );
      }
    });
  }

  #queueFirstPromptTransition(operation: () => Promise<void>): Promise<void> {
    const transition = this.#firstPromptTransition.then(operation);
    this.#firstPromptTransition = transition.catch(() => undefined);
    return transition;
  }

  #observeTurnWatchdog(frame: RpcFrame): void {
    if (this.#watchdogRecovering) return;
    if (frame.type === "agent_start" || frame.type === "turn_start") {
      this.#terminalAnswerPending = false;
      this.#clearTurnWatchdog();
      return;
    }
    if (
      (frame.type === "agent_end" && frame.isTerminal !== false) ||
      (frame.type === "prompt_result" && frame.agentInvoked === false)
    ) {
      this.#terminalAnswerPending = false;
      this.#clearTurnWatchdog();
      return;
    }
    if (isTerminalAssistantMessageEnd(frame)) {
      this.#terminalAnswerPending = true;
    }
    if (!this.#terminalAnswerPending || !this.#streaming) return;
    this.#clearTurnWatchdog(false);
    this.#turnWatchdog = setTimeout(() => {
      this.#turnWatchdog = undefined;
      void this.#recoverStuckTurn();
    }, FINAL_ANSWER_QUIET_MS);
    this.#turnWatchdog.unref?.();
  }

  async #recoverStuckTurn(): Promise<void> {
    const rpc = this.#rpc;
    if (
      this.#disposed ||
      this.#watchdogRecovering ||
      !this.#terminalAnswerPending ||
      !this.#streaming ||
      !rpc?.running
    ) return;
    this.#watchdogRecovering = true;
    try {
      const before = responseData(await rpc.request({ type: "get_state" }, 10_000));
      if (before.isStreaming === true) {
        await rpc.request({ type: "abort" }, 10_000);
      }
      const after = responseData(await rpc.request({ type: "get_state" }, 10_000));
      if (after.isStreaming === true) {
        throw new Error("OMP remained streaming after one recovery abort");
      }
      this.#streaming = false;
      this.#terminalAnswerPending = false;
      this.#onStatusChange("idle");
      await this.#post({
        type: "rpc",
        frame: {
          type: "notice",
          level: "warning",
          source: "OMP transport recovered",
          message: "Final answer was complete but RPC remained busy; one bounded abort restored the session.",
        },
      });
    } catch (error) {
      this.#logger.error(`RPC stuck-turn recovery failed for "${this.#label}"`, error);
      this.#onStatusChange("failed");
      await this.#post({
        type: "transport",
        status: "failed",
        detail: "OMP remained busy after a completed answer. Restart this chat runtime.",
      });
    } finally {
      this.#watchdogRecovering = false;
    }
  }

  #clearTurnWatchdog(resetTerminal = true): void {
    if (this.#turnWatchdog) clearTimeout(this.#turnWatchdog);
    this.#turnWatchdog = undefined;
    if (resetTerminal) this.#terminalAnswerPending = false;
  }

  async #restoreDrafts(drafts: readonly PromptDraft[]): Promise<void> {
    let images: PromptImage[] = [];
    for (const image of drafts.flatMap((draft) => draft.images)) {
      const next = parsePromptImages([...images, image]);
      if (next === null) break;
      images = next;
    }
    await this.#post({
      type: "restoreDraft",
      text: drafts.map((draft) => draft.message).join("\n\n"),
      images,
    });
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
    return resolveSessionFile(this.#cwd, filePath);
  }

  #post(message: unknown, attachmentRevision?: number): Thenable<boolean> {
    if (
      isRecord(message) &&
      (message.type === "restoreDraft" || message.type === "setComposer") &&
      typeof message.text === "string"
    ) {
      this.#viewDraft = message.text;
      if ("images" in message) {
        const images = parsePromptImages(message.images);
        if (images !== null) this.#viewImages = images;
      }
    }
    if (
      attachmentRevision !== undefined &&
      attachmentRevision !== this.#attachmentRevision
    ) {
      return Promise.resolve(false);
    }
    const webview = this.#webview;
    const surfaceToken = this.#surfaceToken;
    return webview && surfaceToken
      ? webview.postMessage(tagSurfaceMessage(message, surfaceToken))
      : Promise.resolve(false);
  }

  async #postBootstrap(attachmentRevision: number): Promise<void> {
    await this.#post({
      type: "bootstrap",
      cwd: this.#cwd,
      branch: this.#branch,
      sessionName: this.#label,
      kind: this.#kind,
      advisorLabel: this.#parity
        ? this.#advisorVerifiedAt
          ? "Verified live: GPT-5.6 Sol · Extra High"
          : "Checking: GPT-5.6 Sol · Extra High"
        : "OMP project policy",
      parityRequired: Boolean(this.#parity),
      trustedProjectPolicy: this.#parity?.name.startsWith("dzialki-") === true,
    }, attachmentRevision);
  }

  async #rehydrateWebview(attachmentRevision: number): Promise<void> {
    const rpc = this.#rpc;
    if (
      !rpc?.running ||
      !this.#webviewReady ||
      attachmentRevision !== this.#attachmentRevision
    ) return;
    this.#viewReplay.begin(attachmentRevision);
    try {
      const stateResponse = await rpc.request({ type: "get_state" });
      if (attachmentRevision !== this.#attachmentRevision) return;
      await this.#post(
        { type: "rpc", frame: stateResponse },
        attachmentRevision,
      );
      await this.#post({
        type: "parity",
        ok: this.#parityPassed && !this.#parityFailed,
        ...(!this.#parityPassed || this.#parityFailed
          ? { detail: "Runtime parity has not passed" }
          : {}),
      }, attachmentRevision);
      if (!this.#parityPassed || this.#parityFailed) return;
      this.#historySnapshot = await loadRpcMessageHistory(rpc);
      if (attachmentRevision !== this.#attachmentRevision) return;
      const activeTurnAtBoundary = this.#activeTurnOverflow
        ? []
        : [...this.#activeTurnFrames];
      const pendingAtBoundary = this.#viewReplay.pendingUiRequests();
      // get_messages is authoritative for everything emitted before its
      // response. Keep only frames arriving after that protocol boundary.
      this.#viewReplay.resetAtHistoryBoundary(attachmentRevision);
      await this.#post(
        { type: "rpc", frame: this.#historySnapshot },
        attachmentRevision,
      );
      if (this.#commandsSnapshot) {
        await this.#post(
          { type: "rpc", frame: this.#commandsSnapshot },
          attachmentRevision,
        );
      }
      for (const frame of activeTurnAtBoundary) {
        if (attachmentRevision !== this.#attachmentRevision) return;
        await this.#post(
          { type: "rpc", frame },
          attachmentRevision,
        );
      }
      const activeRequestIds = new Set(
        activeTurnAtBoundary
          .filter((frame) => frame.type === "extension_ui_request")
          .map((frame) => (typeof frame.id === "string" ? frame.id : "")),
      );
      for (const frame of pendingAtBoundary) {
        if (attachmentRevision !== this.#attachmentRevision) return;
        if (typeof frame.id === "string" && activeRequestIds.has(frame.id)) {
          continue;
        }
        await this.#post({ type: "rpc", frame }, attachmentRevision);
      }
      await this.#drainRehydrationFrames(attachmentRevision);
      await this.#post(
        { type: "transport", status: "ready" },
        attachmentRevision,
      );
    } catch (error) {
      this.#logger.error(
        `Failed to restore RPC view for "${this.#label}"`,
        error,
      );
      await this.#post({
        type: "transport",
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      }, attachmentRevision);
    } finally {
      this.#viewReplay.finish(attachmentRevision);
    }
  }

  #observeRpcFrame(frame: RpcFrame): void {
    this.#viewReplay.observeUiRequest(frame);
    if (frame.type === "agent_start" && !this.#streaming) {
      this.#activeTurnFrames = [];
      this.#activeTurnBytes = 0;
      this.#activeTurnOverflow = false;
    }
    if (frame.type === "agent_start" || this.#streaming) {
      this.#rememberActiveTurnFrame(frame);
    }
    if (
      (frame.type === "agent_end" && frame.isTerminal !== false) ||
      (frame.type === "prompt_result" && frame.agentInvoked === false)
    ) {
      this.#activeTurnFrames = [];
      this.#activeTurnBytes = 0;
      this.#activeTurnOverflow = false;
    }
  }

  #deliverRpcFrame(frame: RpcFrame): void {
    if (this.#viewReplay.capture(this.#attachmentRevision, frame)) return;
    void this.#post({ type: "rpc", frame });
  }

  async #drainRehydrationFrames(attachmentRevision: number): Promise<void> {
    while (
      attachmentRevision === this.#attachmentRevision
    ) {
      const frames = this.#viewReplay.drain(attachmentRevision);
      if (frames.length === 0) {
        this.#viewReplay.finish(attachmentRevision);
        return;
      }
      for (const frame of frames) {
        await this.#post({ type: "rpc", frame }, attachmentRevision);
      }
    }
  }

  #cancelRehydration(): void {
    this.#viewReplay.cancel();
  }

  #rememberActiveTurnFrame(frame: RpcFrame): void {
    if (this.#activeTurnOverflow) return;
    const bytes = Buffer.byteLength(JSON.stringify(frame), "utf8");
    if (
      this.#activeTurnFrames.length >= 4096 ||
      this.#activeTurnBytes + bytes > 8 * 1024 * 1024
    ) {
      this.#activeTurnFrames = [];
      this.#activeTurnBytes = 0;
      this.#activeTurnOverflow = true;
      return;
    }
    this.#activeTurnFrames.push(frame);
    this.#activeTurnBytes += bytes;
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
