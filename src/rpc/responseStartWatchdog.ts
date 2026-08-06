import type { RpcFrame } from "./RpcProcess";

export const DZIALKI_RESPONSE_WAIT_MS = 12_000;
export const DZIALKI_RESPONSE_TIMEOUT_MS = 20_000;

export type ResponseStartScheduler = {
  set(delayMs: number, callback: () => void): unknown;
  clear(handle: unknown): void;
};

type ResponseStartWatchdogOptions = {
  waitMs?: number;
  timeoutMs?: number;
  scheduler?: ResponseStartScheduler;
  onWaiting: () => void;
  onTimeout: () => void;
};

const defaultScheduler: ResponseStartScheduler = {
  set(delayMs, callback) {
    const timer = setTimeout(callback, delayMs);
    timer.unref?.();
    return timer;
  },
  clear(handle) {
    clearTimeout(handle as NodeJS.Timeout);
  },
};

/**
 * Bounds time-to-first-semantic-output for the exact Dzialki Opus driver.
 * OMP 17.2.9 does not expose its provider-local Anthropic retry lifecycle over
 * RPC, so host response-start timeout is only way to stop hidden minute-long
 * retries without changing model or credentials.
 */
export class ResponseStartWatchdog {
  readonly #waitMs: number;
  readonly #timeoutMs: number;
  readonly #scheduler: ResponseStartScheduler;
  readonly #onWaiting: () => void;
  readonly #onTimeout: () => void;
  #waitHandle: unknown;
  #timeoutHandle: unknown;

  constructor(options: ResponseStartWatchdogOptions) {
    this.#waitMs = options.waitMs ?? DZIALKI_RESPONSE_WAIT_MS;
    this.#timeoutMs = options.timeoutMs ?? DZIALKI_RESPONSE_TIMEOUT_MS;
    this.#scheduler = options.scheduler ?? defaultScheduler;
    this.#onWaiting = options.onWaiting;
    this.#onTimeout = options.onTimeout;
  }

  arm(): void {
    this.clear();
    this.#waitHandle = this.#scheduler.set(this.#waitMs, () => {
      this.#waitHandle = undefined;
      this.#onWaiting();
    });
    this.#timeoutHandle = this.#scheduler.set(this.#timeoutMs, () => {
      this.#timeoutHandle = undefined;
      if (this.#waitHandle !== undefined) {
        this.#scheduler.clear(this.#waitHandle);
        this.#waitHandle = undefined;
      }
      this.#onTimeout();
    });
  }

  observe(frame: RpcFrame): void {
    if (isSemanticResponseFrame(frame) || responseTurnSettled(frame)) {
      this.clear();
    }
  }

  clear(): void {
    if (this.#waitHandle !== undefined) {
      this.#scheduler.clear(this.#waitHandle);
      this.#waitHandle = undefined;
    }
    if (this.#timeoutHandle !== undefined) {
      this.#scheduler.clear(this.#timeoutHandle);
      this.#timeoutHandle = undefined;
    }
  }
}

export function shouldWatchResponseStart(
  parityName: string | undefined,
  kind: string,
  _promptType: "prompt" | "steer" | "follow_up",
  alreadyStreaming: boolean,
): boolean {
  // `alreadyStreaming`, not the prompt type, is what decides this. A steer or
  // follow-up sent while the session is idle waits for first output exactly
  // like a fresh prompt, and used to hang with no SLA and no retry card.
  return (
    parityName === "dzialki-work" && kind === "work" && !alreadyStreaming
  );
}

export function isSemanticResponseFrame(frame: RpcFrame): boolean {
  if (frame.type === "tool_execution_start") return true;
  if (
    frame.type !== "message_start" &&
    frame.type !== "message_update" &&
    frame.type !== "message_end"
  ) {
    return false;
  }
  if (!isRecord(frame.message) || frame.message.role !== "assistant") {
    return false;
  }
  if (nonEmptyString(frame.message.errorMessage)) return true;
  const content = frame.message.content;
  if (typeof content === "string") return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  return content.some((block) => {
    if (!isRecord(block)) return false;
    if (block.type === "image" || block.type === "toolCall") return true;
    if (block.type === "text") return nonEmptyString(block.text);
    if (block.type === "thinking") return nonEmptyString(block.thinking);
    return false;
  });
}

export function isProviderOverloadFrame(frame: RpcFrame): boolean {
  if (frame.type !== "auto_retry_start" && frame.type !== "auto_retry_end") {
    return false;
  }
  return isProviderOverloadText(
    typeof frame.errorMessage === "string"
      ? frame.errorMessage
      : typeof frame.finalError === "string"
        ? frame.finalError
        : "",
  );
}

export function isProviderOverloadText(value: string): boolean {
  return /(?:overloaded_error|\boverloaded\b)/i.test(value);
}

function responseTurnSettled(frame: RpcFrame): boolean {
  return (
    (frame.type === "agent_end" && frame.isTerminal !== false) ||
    (frame.type === "prompt_result" && frame.agentInvoked === false)
  );
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
