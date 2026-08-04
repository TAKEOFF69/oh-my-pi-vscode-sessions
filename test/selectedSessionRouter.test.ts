import assert from "node:assert/strict";
import test from "node:test";

import {
  SelectedSessionRouter,
  type RoutedSessionHost,
} from "../src/sidebar/SelectedSessionRouter";

class FakeHost implements RoutedSessionHost<string> {
  readonly received: unknown[] = [];
  readonly attached: Array<{ view: string; surfaceToken: string }> = [];
  readonly detached: Array<string | undefined> = [];
  focusCount = 0;

  attachWebview(view: string, surfaceToken: string): void {
    this.attached.push({ view, surfaceToken });
  }
  detachWebview(view?: string): void { this.detached.push(view); }
  async handleWebviewMessage(raw: unknown): Promise<void> { this.received.push(raw); }
  focus(): void { this.focusCount += 1; }
}

test("selected sidebar session exclusively receives prompts, aborts, and approvals", async () => {
  const router = new SelectedSessionRouter<string, FakeHost>();
  const first = new FakeHost();
  const second = new FakeHost();

  router.select("first", first, "sidebar", "surface-first");
  await router.dispatch({ type: "prompt", message: "one" });
  await router.dispatch({ type: "extensionUiResponse", id: "same-id", confirmed: true });
  router.select("second", second, "sidebar", "surface-second");
  await router.dispatch({ type: "abort" });
  await router.dispatch({ type: "extensionUiResponse", id: "same-id", confirmed: false });

  assert.deepEqual(first.received, [
    { type: "prompt", message: "one" },
    { type: "extensionUiResponse", id: "same-id", confirmed: true },
  ]);
  assert.deepEqual(second.received, [
    { type: "abort" },
    { type: "extensionUiResponse", id: "same-id", confirmed: false },
  ]);
  assert.deepEqual(first.detached, ["sidebar"]);
});

test("Back detaches presentation without disposing runtime", async () => {
  const router = new SelectedSessionRouter<string, FakeHost>();
  const host = new FakeHost();
  router.select("session", host, "sidebar", "surface-session");
  router.clear("sidebar");
  await router.dispatch({ type: "prompt", message: "must not route" });
  assert.deepEqual(host.detached, ["sidebar"]);
  assert.deepEqual(host.received, []);
});
