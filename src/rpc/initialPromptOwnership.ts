export type InitialPromptState = "pending" | "delivered" | "restored" | "none";

/**
 * Transfers one startup prompt exactly once: either to OMP or back to the user.
 * State deliberately survives RPC restarts so a restored draft is never auto-sent.
 */
export class InitialPromptOwnership {
  readonly #prompt: string | undefined;
  #state: InitialPromptState;

  constructor(prompt?: string) {
    this.#prompt = prompt;
    this.#state = prompt ? "pending" : "none";
  }

  get state(): InitialPromptState {
    return this.#state;
  }

  claimForDelivery(): string | undefined {
    if (this.#state !== "pending") return undefined;
    this.#state = "delivered";
    return this.#prompt;
  }

  claimForRestore(): string | undefined {
    if (this.#state !== "pending") return undefined;
    this.#state = "restored";
    return this.#prompt;
  }
}
