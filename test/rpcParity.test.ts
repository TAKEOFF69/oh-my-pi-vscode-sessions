import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  formatRpcParityFindings,
  type RpcParityProfile,
  type RpcSessionState,
  validateRpcParity,
  validateRpcRuntimeConfigFrame,
} from "../src/rpc/parity";

type Fixture = {
  state: RpcSessionState;
  profile: RpcParityProfile;
};

test("RPC parity accepts exact runtime state", () => {
  const fixture = readFixture("rpc-parity.good.json");
  assert.deepEqual(validateRpcParity(fixture.state, fixture.profile), []);
});

test("RPC parity seeded RED catches every protected dimension", () => {
  const fixture = readFixture("rpc-parity.bad.json");
  const findings = validateRpcParity(fixture.state, fixture.profile);
  const codes = new Set(findings.map((finding) => finding.code));

  assert.deepEqual(codes, new Set([
    "model-provider",
    "model-id",
    "thinking-level",
    "cwd",
    "missing-tool",
    "forbidden-tool",
    "unexpected-tool",
  ]));
  assert.match(formatRpcParityFindings(findings), /claude-opus-5/);
  assert.match(formatRpcParityFindings(findings), /loop_control/);
  assert.match(formatRpcParityFindings(findings), /without bash/);
});

test("RPC parity rejects tools outside exact allowed inventory", () => {
  const fixture = readFixture("rpc-parity.good.json");
  fixture.state.dumpTools = [
    ...(fixture.state.dumpTools ?? []),
    { name: "surprise_tool" },
  ];
  assert.deepEqual(
    validateRpcParity(fixture.state, fixture.profile)
      .filter((finding) => finding.code === "unexpected-tool")
      .map((finding) => finding.actual),
    ["surprise_tool"],
  );
});

test("runtime config updates preserve the exact driver lock", () => {
  const fixture = readFixture("rpc-parity.good.json");
  assert.deepEqual(validateRpcRuntimeConfigFrame({
    type: "config_update",
    model: fixture.state.model,
    thinkingLevel: fixture.state.thinkingLevel,
  }, fixture.profile), []);

  const findings = validateRpcRuntimeConfigFrame({
    type: "config_update",
    model: { provider: "anthropic", id: "claude-opus-4-8" },
    thinkingLevel: "high",
  }, fixture.profile);
  assert.deepEqual(
    findings.map((finding) => finding.code),
    ["model-id", "thinking-level"],
  );
});

test("runtime lock covers OMP 17.1.3 model and thinking mutation frames", () => {
  const fixture = readFixture("rpc-parity.good.json");
  const modelFindings = validateRpcRuntimeConfigFrame({
    type: "response",
    command: "cycle_model",
    success: true,
    data: {
      model: { provider: "openai-codex", id: "gpt-5.3-codex-spark" },
      thinkingLevel: "xhigh",
    },
  }, fixture.profile);
  assert.deepEqual(
    modelFindings.map((finding) => finding.code),
    ["model-provider", "model-id"],
  );

  const effortFindings = validateRpcRuntimeConfigFrame({
    type: "thinking_level_changed",
    thinkingLevel: "high",
  }, fixture.profile);
  assert.deepEqual(
    effortFindings.map((finding) => finding.code),
    ["thinking-level"],
  );

  assert.deepEqual(validateRpcRuntimeConfigFrame({
    type: "response",
    command: "set_thinking_level",
    success: true,
    data: {},
  }, fixture.profile), []);

  assert.deepEqual(
    validateRpcRuntimeConfigFrame({
      type: "response",
      command: "set_model",
      success: true,
      data: {},
    }, fixture.profile).map((finding) => finding.code),
    ["model-provider", "model-id"],
  );
});

function readFixture(name: string): Fixture {
  const path = fileURLToPath(
    new URL(`./fixtures/${name}`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}
