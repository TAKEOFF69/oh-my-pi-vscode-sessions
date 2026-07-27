import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  type RpcParityProfile,
  type RpcSessionState,
  validateRpcParity,
} from "../src/rpc/parity";

type Fixture = {
  state: RpcSessionState;
  profile: RpcParityProfile;
};

const readFixture = (name: string): Fixture =>
  JSON.parse(
    readFileSync(path.join("test", "fixtures", name), "utf8"),
  ) as Fixture;

const good = readFixture("rpc-parity.good.json");
const bad = readFixture("rpc-parity.bad.json");

assert.deepEqual(validateRpcParity(good.state, good.profile), []);
const badFindings = validateRpcParity(bad.state, bad.profile);
assert.ok(badFindings.length >= 6);
assert.ok(badFindings.some((finding) => finding.code === "model-id"));
assert.ok(badFindings.some((finding) => finding.code === "forbidden-tool"));
process.stdout.write(
  `rpc-parity selftest: GREEN exact fixture; RED fixture caught ${badFindings.length} defects\n`,
);
