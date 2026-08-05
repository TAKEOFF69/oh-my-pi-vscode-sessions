import type * as vscode from "vscode";

import {
  parsePromptImages,
  promptFrameFits,
  type PromptDraft,
} from "../promptImages";

const STORAGE_KEY = "ohMyPiSessions.pendingDraft.v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1_000;

export type PendingDraft = PromptDraft & {
  token: string;
  updatedAt: number;
};

export class PendingDraftStore {
  readonly #memento: vscode.Memento;
  #current: PendingDraft | undefined;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(memento: vscode.Memento, now = Date.now()) {
    this.#memento = memento;
    this.#current = sanitize(memento.get<unknown>(STORAGE_KEY), now);
    if (!this.#current && memento.get<unknown>(STORAGE_KEY) !== undefined) {
      this.#enqueue(undefined);
    }
  }

  load(): PendingDraft | undefined {
    return this.#current
      ? { ...this.#current, images: [...this.#current.images] }
      : undefined;
  }

  save(value: PendingDraft): Promise<void> {
    const sanitized = sanitize(value, value.updatedAt);
    if (!sanitized) return Promise.reject(new Error("Pending OMP draft is invalid"));
    this.#current = sanitized;
    this.#enqueue(sanitized);
    return this.#writeQueue;
  }

  clear(token: string): Promise<boolean> {
    if (this.#current?.token !== token) return Promise.resolve(false);
    this.#current = undefined;
    this.#enqueue(undefined);
    return this.#writeQueue.then(() => true);
  }

  flush(): Promise<void> {
    return this.#writeQueue;
  }

  #enqueue(value: PendingDraft | undefined): void {
    this.#writeQueue = this.#writeQueue
      .catch(() => undefined)
      .then(() => Promise.resolve(this.#memento.update(STORAGE_KEY, value)));
  }
}

function sanitize(value: unknown, now: number): PendingDraft | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.token !== "string" ||
    !value.token ||
    typeof value.message !== "string" ||
    (!value.message.trim() && !Array.isArray(value.images)) ||
    typeof value.updatedAt !== "number" ||
    now - value.updatedAt > MAX_AGE_MS ||
    value.updatedAt - now > 60_000
  ) return undefined;
  const images = parsePromptImages(value.images);
  if (
    images === null ||
    (!value.message.trim() && images.length === 0) ||
    !promptFrameFits(value.message, images)
  ) return undefined;
  return {
    token: value.token,
    message: value.message,
    images,
    updatedAt: value.updatedAt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
