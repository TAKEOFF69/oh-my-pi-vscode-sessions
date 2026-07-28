import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSessionLaunchPlan,
  canOfferReadOnlyDowngrade,
  resolveEffectiveSessionKind,
} from "../src/sessionLaunch";

const projectLauncher = {
  executable: "node.exe",
  baseArgs: ["C:\\repo\\scripts\\omp\\launch.mjs"],
  readOnlyArgument: "--read-only",
  rpcArgument: "--rpc",
  parityKind: "dzialki-v1" as const,
};

test("work RPC launch uses repository launcher and exact parity", () => {
  const plan = buildSessionLaunchPlan({
    kind: "work",
    transport: "rpc",
    cwd: "C:\\repo",
    projectLauncher,
    fallbackExecutable: "omp.exe",
  });

  assert.deepEqual(plan.args, [
    "C:\\repo\\scripts\\omp\\launch.mjs",
    "--rpc",
  ]);
  assert.equal(plan.parity?.modelId, "claude-opus-5");
  assert.equal(plan.parity?.thinkingLevel, "max");
  assert.ok(plan.parity?.requiredTools.includes("edit"));
  assert.ok(plan.parity?.allowedTools.includes("hub"));
  assert.ok(!plan.parity?.allowedTools.includes("loop_control"));
  assert.ok(plan.parity?.allowedTools.includes("loop_handoff"));
});

test("read-only RPC launch excludes mutations", () => {
  const plan = buildSessionLaunchPlan({
    kind: "readonly",
    transport: "rpc",
    cwd: "C:\\repo",
    projectLauncher,
    fallbackExecutable: "omp.exe",
  });

  assert.deepEqual(plan.args, [
    "C:\\repo\\scripts\\omp\\launch.mjs",
    "--read-only",
    "--rpc",
  ]);
  assert.ok(plan.parity?.forbiddenTools.includes("bash"));
  assert.ok(plan.parity?.forbiddenTools.includes("task"));
  assert.deepEqual(
    plan.parity?.allowedTools,
    [
      "read",
      "grep",
      "glob",
      "lsp",
      "todo",
      "dzialki_policy_status",
    ],
  );
});

test("Loop RPC launch leaves initial prompt to host after parity", () => {
  const plan = buildSessionLaunchPlan({
    kind: "loop",
    transport: "rpc",
    cwd: "C:\\repo",
    loopAlias: "consumer-share",
    projectLauncher,
    fallbackExecutable: "omp.exe",
  });

  assert.deepEqual(plan.args, [
    "C:\\repo\\scripts\\omp\\launch.mjs",
    "--loop",
    "consumer-share",
    "--rpc",
  ]);
  assert.equal(plan.initialPrompt, "/loop-start consumer-share");
  assert.ok(plan.parity?.requiredTools.includes("loop_control"));
  assert.ok(plan.parity?.forbiddenTools.includes("bash"));
  assert.deepEqual(plan.parity?.allowedTools, [
    "read",
    "grep",
    "glob",
    "lsp",
    "todo",
    "loop_control",
    "loop_dispatch_plan",
    "hub",
    "dzialki_policy_status",
  ]);
});

test("diagnostic TUI launch never receives RPC mode", () => {
  const plan = buildSessionLaunchPlan({
    kind: "work",
    transport: "terminal",
    cwd: "C:\\repo",
    projectLauncher,
    fallbackExecutable: "omp.exe",
  });
  assert.deepEqual(plan.args, ["C:\\repo\\scripts\\omp\\launch.mjs"]);
  assert.equal(plan.parity, undefined);
});

test("generic RPC uses direct OMP mode and Loop fails closed", () => {
  assert.deepEqual(
    buildSessionLaunchPlan({
      kind: "work",
      transport: "rpc",
      cwd: "C:\\repo",
      fallbackExecutable: "omp.exe",
      defaultArguments: ["--advisor"],
    }).args,
    ["--advisor", "--mode=rpc"],
  );
  assert.throws(
    () =>
      buildSessionLaunchPlan({
        kind: "loop",
        transport: "rpc",
        cwd: "C:\\repo",
        loopAlias: "arc",
        fallbackExecutable: "omp.exe",
      }),
    /requires repository-owned/,
  );
});

test("generic sessions cannot claim lease-free read-only capability", () => {
  assert.deepEqual(
    resolveEffectiveSessionKind("readonly", "rpc", true),
    { kind: "readonly" },
  );
  assert.match(
    resolveEffectiveSessionKind("readonly", "rpc", false).blockReason ?? "",
    /trusted project policy launcher/,
  );
  assert.deepEqual(
    resolveEffectiveSessionKind("readonly", "terminal", false),
    { kind: "work" },
  );
  assert.equal(canOfferReadOnlyDowngrade(false), false);
  assert.equal(canOfferReadOnlyDowngrade(true), true);
  assert.match(
    resolveEffectiveSessionKind(
      "readonly",
      "rpc",
      canOfferReadOnlyDowngrade(false),
    ).blockReason ?? "",
    /trusted project policy launcher/,
    "generic Work conflict downgrade must fail closed",
  );
});
