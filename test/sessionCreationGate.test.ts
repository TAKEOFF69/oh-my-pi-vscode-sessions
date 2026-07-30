import assert from "node:assert/strict";
import { test } from "node:test";

import { SessionCreationGate } from "../src/sessionCreationGate";

test("duplicate New Session requests join one in-flight creation", async () => {
  let now = 1_000;
  let starts = 0;
  let release!: (value: string) => void;
  const pending = new Promise<string>((resolve) => {
    release = resolve;
  });
  const gate = new SessionCreationGate<string>({
    cooldownMs: 1_500,
    now: () => now,
  });

  const first = gate.run(async () => {
    starts += 1;
    return pending;
  });
  const duplicate = gate.run(async () => {
    starts += 1;
    return "duplicate";
  });

  assert.equal(starts, 1);
  assert.equal(first, duplicate);
  release("created");
  assert.equal(await first, "created");

  now += 10;
  assert.equal(
    await gate.run(async () => {
      starts += 1;
      return "too soon";
    }),
    undefined,
  );
  assert.equal(starts, 1);
});

test("later deliberate New Session request starts normally", async () => {
  let now = 5_000;
  let starts = 0;
  const gate = new SessionCreationGate<string>({
    cooldownMs: 1_500,
    now: () => now,
  });

  assert.equal(
    await gate.run(async () => {
      starts += 1;
      return "first";
    }),
    "first",
  );
  now += 1_501;
  assert.equal(
    await gate.run(async () => {
      starts += 1;
      return "second";
    }),
    "second",
  );
  assert.equal(starts, 2);
});
