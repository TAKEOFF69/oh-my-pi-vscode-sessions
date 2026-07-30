import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const extensionSource = readFileSync(
  "src/extension.ts",
  "utf8",
);
const sessionManagerSource = readFileSync(
  "src/sessions/SessionManager.ts",
  "utf8",
);

test("sidebar exposes one primary New Session path", () => {
  const welcome = manifest.contributes.viewsWelcome.find(
    (entry: { view?: string }) =>
      entry.view === "ohMyPiSessions.sessions",
  );
  assert.match(welcome.contents, /\[New session\]/);
  assert.doesNotMatch(
    welcome.contents,
    /newLoopSession|newReadOnlySession|newTerminalSession/,
  );

  const titleCommands = manifest.contributes.menus["view/title"].map(
    (entry: { command: string }) => entry.command,
  );
  assert.deepEqual(titleCommands, [
    "ohMyPiSessions.newSession",
    "ohMyPiSessions.closeAll",
  ]);
  assert.match(
    extensionSource,
    /registerCommand\("ohMyPiSessions\.newSession",[\s\S]{0,120}manager\.newPrimarySession\(\)/,
  );
  assert.doesNotMatch(
    extensionSource,
    /manager\.newSession\("work"\)/,
  );
  assert.doesNotMatch(
    sessionManagerSource,
    /return this\.newSession\(\)/,
  );
});

test("specialized profiles remain advanced commands", () => {
  const commands = new Map<string, string>(
    manifest.contributes.commands.map(
      (entry: { command: string; title: string }) => [
        entry.command,
        entry.title,
      ],
    ),
  );
  for (const command of [
    "ohMyPiSessions.newSessionInWorktree",
    "ohMyPiSessions.newTerminalSession",
    "ohMyPiSessions.newReadOnlySession",
    "ohMyPiSessions.newLoopSession",
  ]) {
    assert.match(commands.get(command) ?? "", /^Advanced:/);
  }
});
