import type * as vscode from "vscode";

import type {
  SessionKind,
  SessionTransport,
} from "./SessionPanel";
import type { SessionTitleSource } from "../sessionTitle";
import {
  deriveSessionTitle,
  infrastructureTitle,
} from "../sessionTitle";

const STORAGE_KEY = "ohMyPiSessions.recentSessions.v1";
const MAX_RECENT_SESSIONS = 50;

export type RecentSessionRecord = {
  id: string;
  label: string;
  cwd: string;
  branch?: string;
  loopAlias?: string;
  kind: SessionKind;
  transport: SessionTransport;
  sessionFile: string;
  updatedAt: number;
  titleSource: SessionTitleSource;
};

export class RecentSessionStore {
  readonly #memento: vscode.Memento;
  #records: RecentSessionRecord[];
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(memento: vscode.Memento) {
    this.#memento = memento;
    this.#records = sanitizeRecords(
      memento.get<unknown>(STORAGE_KEY),
    );
  }

  list(): readonly RecentSessionRecord[] {
    return [...this.#records];
  }

  find(id: string): RecentSessionRecord | undefined {
    return this.#records.find((record) => record.id === id);
  }

  upsert(record: RecentSessionRecord): void {
    const next = [
      record,
      ...this.#records.filter((candidate) => candidate.id !== record.id),
    ]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_RECENT_SESSIONS);
    if (JSON.stringify(next) === JSON.stringify(this.#records)) return;
    this.#records = next;
    this.#writeQueue = this.#writeQueue
      .catch(() => undefined)
      .then(() => Promise.resolve(this.#memento.update(STORAGE_KEY, next)));
  }

  remove(id: string): void {
    const next = this.#records.filter((record) => record.id !== id);
    if (next.length === this.#records.length) return;
    this.#records = next;
    this.#writeQueue = this.#writeQueue
      .catch(() => undefined)
      .then(() => Promise.resolve(this.#memento.update(STORAGE_KEY, next)));
  }

  flush(): Promise<void> {
    return this.#writeQueue;
  }
}

function sanitizeRecords(raw: unknown): RecentSessionRecord[] {
  if (!Array.isArray(raw)) return [];
  const records: RecentSessionRecord[] = [];
  for (const value of raw) {
    if (!isRecord(value)) continue;
    if (
      typeof value.id !== "string" ||
      typeof value.label !== "string" ||
      typeof value.cwd !== "string" ||
      typeof value.sessionFile !== "string" ||
      typeof value.updatedAt !== "number" ||
      !["work", "readonly", "loop"].includes(String(value.kind)) ||
      value.transport !== "rpc"
    ) {
      continue;
    }
    const titleSource =
      value.titleSource === "manual" || value.titleSource === "runtime"
        ? value.titleSource
        : "provisional";
    const storedLabel = value.label.trim();
    const label = infrastructureTitle(
      storedLabel,
      typeof value.branch === "string" ? value.branch : undefined,
      value.cwd,
    )
      ? typeof value.loopAlias === "string"
        ? deriveSessionTitle(`/loop-start ${value.loopAlias}`)
        : "Saved OMP chat"
      : titleSource === "provisional"
        ? deriveSessionTitle(storedLabel)
        : storedLabel;
    records.push({
      id: value.id,
      label,
      cwd: value.cwd,
      ...(typeof value.branch === "string" ? { branch: value.branch } : {}),
      ...(typeof value.loopAlias === "string"
        ? { loopAlias: value.loopAlias }
        : {}),
      kind: value.kind as SessionKind,
      transport: "rpc",
      sessionFile: value.sessionFile,
      updatedAt: value.updatedAt,
      titleSource,
    });
  }
  return records
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_RECENT_SESSIONS);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
