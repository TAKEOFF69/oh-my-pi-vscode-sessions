export class TeardownBarrier {
  #pending: Promise<void> = Promise.resolve();

  enqueue(teardown: () => Promise<void>): Promise<void> {
    this.#pending = this.#pending.then(teardown);
    return this.#pending;
  }

  wait(): Promise<void> {
    return this.#pending;
  }
}
