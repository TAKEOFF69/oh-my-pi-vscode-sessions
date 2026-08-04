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
const sessionPanelSource = readFileSync(
  "src/sessions/SessionPanel.ts",
  "utf8",
);
const roleConfig = readFileSync("config/driver.yml", "utf8");

test("sidebar exposes one primary New Session path", () => {
  const view = manifest.contributes.views["oh-my-pi-sessions"].find(
    (entry: { id?: string }) => entry.id === "ohMyPiSessions.sessions",
  );
  assert.equal(view.type, "webview");
  assert.equal(view.name, "Chats");
  assert.equal(manifest.contributes.viewsWelcome, undefined);
  assert.equal(manifest.contributes.menus["view/title"], undefined);
  assert.match(extensionSource, /registerWebviewViewProvider/);
  assert.doesNotMatch(extensionSource, /registerTreeDataProvider/);
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
  assert.match(
    sessionManagerSource,
    /if \(!prompt\?\.trim\(\)\)[\s\S]{0,100}this\.focusNewSession\(\)/,
  );
  assert.match(
    sessionPanelSource,
    /if \(spec\.transport === "rpc"\)[\s\S]{0,120}this\.panel = undefined/,
  );
  assert.doesNotMatch(
    sessionPanelSource,
    /if \(spec\.transport === "rpc"\)[\s\S]{0,1200}createWebviewPanel/,
  );
  assert.equal(
    manifest.contributes.keybindings.find(
      (entry: { command: string }) =>
        entry.command === "ohMyPiSessions.searchSession",
    ).when,
    "focusedView == ohMyPiSessions.sessions",
  );
});

test("all normal sessions lock exact driver and advisor roles", () => {
  assert.match(roleConfig, /default: anthropic\/claude-opus-5:xhigh/);
  assert.match(roleConfig, /advisor: openai-codex\/gpt-5\.6-sol:xhigh/);
  assert.match(roleConfig, /modelFallback: false/);
  assert.match(sessionManagerSource, /"config",\s*"driver\.yml"/);
  assert.match(sessionManagerSource, /Opus 5 · Extra High/);
  assert.match(sessionManagerSource, /GPT-5\.6 Sol Extra High advisor/);
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
