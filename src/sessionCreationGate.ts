export type SessionCreationSuppression =
  | "in-flight"
  | "cooldown";

type SessionCreationGateOptions = {
  cooldownMs: number;
  now?: () => number;
};

export class SessionCreationGate<T> {
  readonly #cooldownMs: number;
  readonly #now: () => number;
  #inFlight: Promise<T> | undefined;
  #lastFinishedAt = Number.NEGATIVE_INFINITY;

  constructor(options: SessionCreationGateOptions) {
    this.#cooldownMs = options.cooldownMs;
    this.#now = options.now ?? Date.now;
  }

  run(
    start: () => Promise<T> | T,
    onSuppressed?: (reason: SessionCreationSuppression) => void,
  ): Promise<T | undefined> {
    if (this.#inFlight) {
      onSuppressed?.("in-flight");
      return this.#inFlight;
    }
    if (this.#now() - this.#lastFinishedAt < this.#cooldownMs) {
      onSuppressed?.("cooldown");
      return Promise.resolve(undefined);
    }

    let pending: Promise<T>;
    try {
      pending = Promise.resolve(start());
    } catch (error) {
      pending = Promise.reject(error);
    }
    this.#inFlight = pending;
    void pending.then(
      () => this.#finish(pending),
      () => this.#finish(pending),
    );
    return pending;
  }

  #finish(pending: Promise<T>): void {
    if (this.#inFlight !== pending) {
      return;
    }
    this.#inFlight = undefined;
    this.#lastFinishedAt = this.#now();
  }
}
