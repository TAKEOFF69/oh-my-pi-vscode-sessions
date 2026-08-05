import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";

import { buildPtyEnv, buildSpawnCommand } from "../spawn";
import {
  DEFAULT_MAX_FRAME_BYTES,
  DEFAULT_MAX_REASSEMBLED_BYTES,
  RpcFrameDecoder,
} from "./frameDecoder";

export type RpcFrame = Record<string, unknown> & {
  type: string;
  id?: string;
};

export type RpcResponse = RpcFrame & {
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
};

export type RpcProcessOptions = {
  executable: string;
  args: readonly string[];
  cwd: string;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  emitTitleEvents?: boolean;
  env?: NodeJS.ProcessEnv;
};

type PendingRequest = {
  command: string;
  resolve: (response: RpcResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class RpcProcess extends EventEmitter {
  readonly #options: Omit<Required<RpcProcessOptions>, "env"> & { env?: NodeJS.ProcessEnv };
  readonly #decoder = new RpcFrameDecoder();
  #child: ChildProcessWithoutNullStreams | undefined;
  #pending = new Map<string, PendingRequest>();
  #requestSequence = 0;
  #started = false;
  #disposed = false;
  #readyResolve!: (frame: RpcFrame) => void;
  #readyReject!: (error: Error) => void;
  #ready: Promise<RpcFrame>;
  #readyTimer: NodeJS.Timeout | undefined;
  #disposePromise: Promise<void> | undefined;

  constructor(options: RpcProcessOptions) {
    super();
    this.#options = {
      ...options,
      startupTimeoutMs: options.startupTimeoutMs ?? 30_000,
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      emitTitleEvents: options.emitTitleEvents ?? false,
    };
    this.#ready = this.#newReadyPromise();
  }

  get running(): boolean {
    return Boolean(
      this.#child &&
        this.#child.exitCode === null &&
        this.#child.signalCode === null,
    );
  }

  async start(): Promise<RpcFrame> {
    if (this.#disposed) {
      throw new Error("RPC process is disposed");
    }
    if (this.#started) {
      return this.#ready;
    }
    this.#started = true;
    const command = buildSpawnCommand(
      this.#options.executable,
      this.#options.args,
    );
    this.#child = spawn(command.file, command.args, {
      cwd: this.#options.cwd,
      env: {
        ...buildPtyEnv(),
        ...this.#options.env,
        ...(this.#options.emitTitleEvents
          ? { PI_RPC_EMIT_TITLE: "1" }
          : {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    this.emit("spawn", {
      executable: command.file,
      cwd: this.#options.cwd,
    });
    this.#readyTimer = setTimeout(() => {
      this.#fail(new Error("OMP RPC did not emit ready frame before timeout"));
    }, this.#options.startupTimeoutMs);

    this.#child.stdout.on("data", (chunk: Buffer) => {
      try {
        for (const frame of this.#decoder.push(chunk)) {
          this.#handleFrame(frame);
        }
      } catch (error) {
        this.#fail(asError(error));
      }
    });
    this.#child.stderr.on("data", (chunk: Buffer) => {
      this.emit("stderr", chunk.toString("utf8"));
    });
    this.#child.on("error", (error) => this.#fail(error));
    this.#child.on("exit", (code, signal) => {
      try {
        for (const frame of this.#decoder.end()) {
          this.#handleFrame(frame);
        }
      } catch (error) {
        this.emit("protocolError", asError(error));
      }
      const detail = `OMP RPC exited with code ${code ?? "null"}${
        signal ? ` (${signal})` : ""
      }`;
      this.#rejectPending(new Error(detail));
      if (this.#readyTimer) {
        clearTimeout(this.#readyTimer);
        this.#readyTimer = undefined;
      }
      if (this.#started && !this.#disposed) {
        this.#readyReject(new Error(detail));
      }
      this.emit("exit", { code, signal });
    });

    const ready = await this.#ready;
    validateReadyForProtocolV2(ready);
    this.#decoder.beginProtocolV2Negotiation();
    const negotiated = await this.request({
      type: "negotiate_protocol",
      protocolVersion: 2,
    });
    const negotiationData = isRecord(negotiated.data)
      ? negotiated.data
      : {};
    if (negotiationData.protocolVersion !== 2) {
      const error = new Error(
        "OMP RPC did not confirm protocolVersion 2",
      );
      this.#fail(error);
      throw error;
    }
    return ready;
  }

  request(
    command: Record<string, unknown> & { type: string },
    timeoutMs = this.#options.requestTimeoutMs,
  ): Promise<RpcResponse> {
    if (!this.running) {
      return Promise.reject(new Error("OMP RPC process is not running"));
    }
    const requestedId =
      typeof command.id === "string" && command.id
        ? command.id
        : undefined;
    const id = requestedId ?? `vscode_${++this.#requestSequence}`;
    if (this.#pending.has(id)) {
      return Promise.reject(new Error(`Duplicate RPC request id ${id}`));
    }
    const frame = { ...command, id };
    return new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new Error(`OMP RPC ${command.type} timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);
      this.#pending.set(id, {
        command: command.type,
        resolve,
        reject,
        timer,
      });
      try {
        this.send(frame);
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(asError(error));
      }
    });
  }

  send(frame: Record<string, unknown>): void {
    if (!this.#child?.stdin.writable) {
      throw new Error("OMP RPC stdin is unavailable");
    }
    this.#child.stdin.write(`${JSON.stringify(frame)}\n`);
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) {
      return this.#disposePromise;
    }
    this.#disposed = true;
    this.#disposePromise = (async () => {
      if (this.#readyTimer) {
        clearTimeout(this.#readyTimer);
        this.#readyTimer = undefined;
      }
      this.#rejectPending(new Error("OMP RPC process disposed"));
      const child = this.#child;
      child?.stdin.end();
      if (child) {
        await terminateChildProcess(child);
      }
      if (this.#child === child) {
        this.#child = undefined;
      }
      this.removeAllListeners();
    })();
    return this.#disposePromise;
  }

  #handleFrame(value: unknown): void {
    if (!isRpcFrame(value)) {
      throw new Error("RPC frame must be a JSON object with string type");
    }
    if (value.type === "ready") {
      if (this.#readyTimer) {
        clearTimeout(this.#readyTimer);
        this.#readyTimer = undefined;
      }
      this.#readyResolve(value);
    } else if (value.type === "response" && typeof value.id === "string") {
      const pending = this.#pending.get(value.id);
      if (pending) {
        this.#pending.delete(value.id);
        clearTimeout(pending.timer);
        const response = value as RpcResponse;
        if (response.success) {
          if (
            pending.command === "negotiate_protocol" &&
            isRecord(response.data) &&
            response.data.protocolVersion === 2
          ) {
            this.#decoder.enableProtocolV2();
          }
          pending.resolve(response);
        } else {
          pending.reject(
            new RpcCommandError(
              pending.command,
              response.error ?? "Unknown RPC error",
              response.code,
            ),
          );
        }
      }
    }
    this.emit("frame", value);
  }

  #fail(error: Error): void {
    this.emit("protocolError", error);
    this.#readyReject(error);
    this.#rejectPending(error);
    if (this.#child && !this.#disposed) {
      void this.dispose().catch((terminationError) => {
        this.emit("protocolError", terminationError);
      });
    }
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #newReadyPromise(): Promise<RpcFrame> {
    return new Promise<RpcFrame>((resolve, reject) => {
      this.#readyResolve = resolve;
      this.#readyReject = reject;
    });
  }
}

export class RpcCommandError extends Error {
  readonly command: string;
  readonly code: string | undefined;

  constructor(command: string, message: string, code?: string) {
    super(`${command}: ${message}`);
    this.name = "RpcCommandError";
    this.command = command;
    this.code = code;
  }
}

function isRpcFrame(value: unknown): value is RpcFrame {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

async function terminateChildProcess(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  if (!child.pid) {
    return;
  }
  if (process.platform === "win32") {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const killer = spawn(
      "taskkill.exe",
      ["/pid", String(child.pid), "/t", "/f"],
      {
        stdio: "ignore",
        windowsHide: true,
      },
    );
    const result = await waitForProcessClose(killer, 5_000);
    if (
      result.code !== 0 &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      throw new Error(
        `Could not terminate OMP RPC process tree ${child.pid}`,
      );
    }
    if (!(await waitForChildExit(child, 5_000))) {
      throw new Error(`Could not reap OMP RPC process ${child.pid}`);
    }
    return;
  }

  const processGroupId = child.pid;
  if (!isProcessGroupAlive(processGroupId)) {
    await waitForChildExit(child, 1_000);
    return;
  }
  signalProcessGroup(processGroupId, "SIGTERM");
  if (await waitForProcessGroupExit(processGroupId, 3_000)) {
    await waitForChildExit(child, 1_000);
    return;
  }
  signalProcessGroup(processGroupId, "SIGKILL");
  if (!(await waitForProcessGroupExit(processGroupId, 5_000))) {
    throw new Error(
      `Could not reap OMP RPC process group ${processGroupId}`,
    );
  }
  if (!(await waitForChildExit(child, 1_000))) {
    throw new Error(`Could not reap OMP RPC process ${child.pid}`);
  }
}

function signalProcessGroup(
  processGroupId: number,
  signal: NodeJS.Signals,
): void {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

function isProcessGroupAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForProcessGroupExit(
  processGroupId: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessGroupAlive(processGroupId)) {
      return true;
    }
    await delay(50);
  }
  return !isProcessGroupAlive(processGroupId);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

type ProcessCloseResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

function waitForProcessClose(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<ProcessCloseResult> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({
      code: child.exitCode,
      signal: child.signalCode,
    });
  } else {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Process terminator timed out"));
      }, timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    });
  }
}

function waitForChildExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

function validateReadyForProtocolV2(ready: RpcFrame): void {
  const supported = Array.isArray(ready.supportedProtocolVersions)
    ? ready.supportedProtocolVersions
    : [];
  if (!supported.includes(2)) {
    throw new Error("OMP RPC does not advertise protocol v2");
  }
  if (ready.maxFrameBytes !== DEFAULT_MAX_FRAME_BYTES) {
    throw new Error(
      `OMP RPC maxFrameBytes must be ${DEFAULT_MAX_FRAME_BYTES}`,
    );
  }
  if (
    ready.maxReassembledFrameBytes !== DEFAULT_MAX_REASSEMBLED_BYTES
  ) {
    throw new Error(
      `OMP RPC maxReassembledFrameBytes must be ${DEFAULT_MAX_REASSEMBLED_BYTES}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
