import * as pty from "@lydell/node-pty";
import { spawn } from "node:child_process";

import { buildPtyEnv, buildSpawnCommand } from "../spawn";

export type PtySessionOptions = {
  executable: string;
  args?: readonly string[];
  cwd: string;
  cols: number;
  rows: number;
  onData: (data: string) => void;
  onExit: (code: number) => void;
};

export class PtySession {
  #proc: pty.IPty | null = null;
  #dataDisposable: pty.IDisposable | null = null;
  #exitDisposable: pty.IDisposable | null = null;
  #exitPromise: Promise<void> | null = null;
  #exitResolve: (() => void) | null = null;
  #disposePromise: Promise<void> | null = null;

  spawn(opts: PtySessionOptions): void {
    if (this.#proc) {
      throw new Error("Previous PTY process has not been reaped");
    }
    this.#disposePromise = null;
    this.#exitPromise = new Promise<void>((resolve) => {
      this.#exitResolve = resolve;
    });

    const { file, args } = buildSpawnCommand(opts.executable, opts.args);

    this.#proc = pty.spawn(file, args, {
      name: "xterm-256color",
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: buildPtyEnv(),
    });

    this.#dataDisposable = this.#proc.onData(opts.onData);
    this.#exitDisposable = this.#proc.onExit(({ exitCode }) => {
      this.#exitResolve?.();
      opts.onExit(exitCode ?? 0);
    });
  }

  write(data: string): void {
    this.#proc?.write(data);
  }

  resize(cols: number, rows: number): void {
    if (cols > 0 && rows > 0) {
      this.#proc?.resize(cols, rows);
    }
  }

  dispose(): Promise<void> {
    if (this.#disposePromise) {
      return this.#disposePromise;
    }
    const proc = this.#proc;
    const exitPromise = this.#exitPromise;
    this.#disposePromise = (async () => {
      if (proc && exitPromise) {
        await terminatePtyProcessTree(proc, exitPromise);
      }
      this.#dataDisposable?.dispose();
      this.#exitDisposable?.dispose();
      this.#dataDisposable = null;
      this.#exitDisposable = null;
      this.#exitPromise = null;
      this.#exitResolve = null;
      if (this.#proc === proc) {
        this.#proc = null;
      }
    })();
    return this.#disposePromise;
  }
}

export async function restartPtyAfterTeardown(
  teardown: () => Promise<void>,
  isDisposed: () => boolean,
  respawn: () => void | Promise<void>,
): Promise<void> {
  await teardown();
  if (!isDisposed()) {
    await respawn();
  }
}

async function terminatePtyProcessTree(
  proc: pty.IPty,
  exitPromise: Promise<void>,
): Promise<void> {
  if (process.platform !== "win32") {
    await terminateUnixPtyProcessGroup(proc.pid);
    if (!(await settlesWithin(exitPromise, 1_000))) {
      throw new Error(`Could not reap OMP PTY root process ${proc.pid}`);
    }
    return;
  }

  if (!(await settlesWithin(exitPromise, 0))) {
    try {
      proc.kill();
    } catch {
      // Process may have exited between the zero-time check and kill.
    }
  }
  if (!(await settlesWithin(exitPromise, 3_000))) {
    const killer = spawn(
      "taskkill.exe",
      ["/pid", String(proc.pid), "/t", "/f"],
      { stdio: "ignore", windowsHide: true },
    );
    await waitForTerminator(killer, 3_000).catch(() => undefined);
  }
  if (!(await settlesWithin(exitPromise, 3_000))) {
    throw new Error(`Could not reap OMP PTY process tree ${proc.pid}`);
  }
}

async function terminateUnixPtyProcessGroup(
  processGroupId: number,
): Promise<void> {
  if (!isPtyProcessGroupAlive(processGroupId)) {
    return;
  }
  signalPtyProcessGroup(processGroupId, "SIGTERM");
  if (await waitForPtyProcessGroupExit(processGroupId, 3_000)) {
    return;
  }
  signalPtyProcessGroup(processGroupId, "SIGKILL");
  if (!(await waitForPtyProcessGroupExit(processGroupId, 5_000))) {
    throw new Error(
      `Could not reap OMP PTY process group ${processGroupId}`,
    );
  }
}

function signalPtyProcessGroup(
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

function isPtyProcessGroupAlive(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function waitForPtyProcessGroupExit(
  processGroupId: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPtyProcessGroupAlive(processGroupId)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !isPtyProcessGroupAlive(processGroupId);
}

function settlesWithin(
  promise: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    promise.then(
      () => {
        clearTimeout(timer);
        finish(true);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function waitForTerminator(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("PTY process-tree terminator timed out"));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
