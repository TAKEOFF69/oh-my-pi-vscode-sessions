import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  formatRpcParityFindings,
  type RpcParityProfile,
  type RpcSessionState,
  validateRpcParity,
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

function readFixture(name: string): Fixture {
  const path = fileURLToPath(
    new URL(`./fixtures/${name}`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}
