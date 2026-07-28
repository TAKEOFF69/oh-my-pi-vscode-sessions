const HANDOFF_PROTOCOL = "dzialki-loop-handoff/v1";
const HANDOFF_ACTION = "open-loop-controller";
const ALIAS_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/i;

export function extractLoopHandoffAlias(
  frame: unknown,
): string | undefined {
  if (
    !isRecord(frame) ||
    frame.type !== "tool_execution_end" ||
    frame.toolName !== "loop_handoff" ||
    frame.isError === true ||
    !isRecord(frame.result) ||
    !isRecord(frame.result.details)
  ) {
    return undefined;
  }
  const details = frame.result.details;
  const alias =
    typeof details.alias === "string" ? details.alias.trim() : "";
  return details.protocol === HANDOFF_PROTOCOL &&
    details.action === HANDOFF_ACTION &&
    ALIAS_PATTERN.test(alias)
    ? alias
    : undefined;
}

export function sameLoopAlias(
  stored: string | undefined,
  requested: string,
): boolean {
  return stored?.toLowerCase() === requested.toLowerCase();
}

export class LoopHandoffSingleFlight<T> {
  readonly #pending = new Map<string, Promise<T>>();

  joinOrStart(
    alias: string,
    start: () => Promise<T>,
  ): { promise: Promise<T>; started: boolean } {
    const key = alias.toLowerCase();
    const pending = this.#pending.get(key);
    if (pending) {
      return { promise: pending, started: false };
    }

    const promise = Promise.resolve().then(start);
    this.#pending.set(key, promise);
    const clear = (): void => {
      if (this.#pending.get(key) === promise) {
        this.#pending.delete(key);
      }
    };
    void promise.then(clear, clear);
    return { promise, started: true };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
