export class PromptLifecycle {
  readonly #drafts = new Map<string, string>();
  readonly #order: string[] = [];

  begin(id: string, draft: string): void {
    this.#drafts.set(id, draft);
    this.#order.push(id);
  }

  has(id: string): boolean {
    return this.#drafts.has(id);
  }

  fail(id: string): string | undefined {
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

  drain(): string[] {
    const drafts = this.#order
      .map((id) => this.#drafts.get(id))
      .filter((draft): draft is string => draft !== undefined);
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
