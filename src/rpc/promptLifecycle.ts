import type { PromptDraft, PromptImage } from "../promptImages";

export class PromptLifecycle {
  readonly #drafts = new Map<string, PromptDraft>();
  readonly #order: string[] = [];

  begin(
    id: string,
    message: string,
    images: readonly PromptImage[] = [],
  ): void {
    this.#drafts.set(id, { message, images: [...images] });
    this.#order.push(id);
  }

  has(id: string): boolean {
    return this.#drafts.has(id);
  }

  fail(id: string): PromptDraft | undefined {
    const draft = this.#drafts.get(id);
    this.#remove(id);
    return draft;
  }

  complete(id: string): void {
    this.#remove(id);
  }

  agentEnded(isTerminal: boolean): void {
    if (!isTerminal) {
      return;
    }
    const oldest = this.#order[0];
    if (oldest) {
      this.#remove(oldest);
    }
  }

  clear(): void {
    this.#drafts.clear();
    this.#order.length = 0;
  }

  drain(): PromptDraft[] {
    const drafts = this.#order
      .map((id) => this.#drafts.get(id))
      .filter((draft): draft is PromptDraft => draft !== undefined);
    this.clear();
    return drafts;
  }

  #remove(id: string): void {
    this.#drafts.delete(id);
    const index = this.#order.indexOf(id);
    if (index >= 0) {
      this.#order.splice(index, 1);
    }
  }
}
