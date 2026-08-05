import readline from "node:readline";
import { spawn } from "node:child_process";

const badReady = process.argv.includes("--bad-ready");
const badNegotiation = process.argv.includes("--bad-negotiation");
const spawnDescendant = process.argv.includes("--spawn-descendant");
const approvalRequest = process.argv.includes("--approval-request");
const slowAdvisor = process.argv.includes("--slow-advisor");
const hangPrompt = process.argv.includes("--hang-prompt");
let advisorPending = false;

const write = (frame) => {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
};

write({
  type: "ready",
  protocolVersion: 1,
  supportedProtocolVersions: [1, 2],
  maxFrameBytes: badReady ? 1024 : 1024 * 1024,
  maxReassembledFrameBytes: 64 * 1024 * 1024,
});

if (spawnDescendant) {
  const descendant = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    {
      stdio: "ignore",
      windowsHide: true,
    },
  );
  write({
    type: "fixture_descendant",
    pid: descendant.pid,
  });
}

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

input.on("line", (line) => {
  let command;
  try {
    command = JSON.parse(line);
  } catch {
    process.stderr.write("invalid input\n");
    return;
  }

  if (command.type === "negotiate_protocol") {
    respond(command, {
      protocolVersion: badNegotiation ? 1 : command.protocolVersion,
    });
    return;
  }
  if (command.type === "get_state") {
    respond(command, {
      model: {
        provider: "anthropic",
        id: "claude-opus-5",
      },
      thinkingLevel: "xhigh",
      sessionId: `fake-session-${process.pid}`,
      sessionFile: `C:/tmp/fake-session-${process.pid}.jsonl`,
      messageCount: 0,
      isStreaming: false,
      dumpTools: [
        { name: "read" },
        { name: "grep" },
        { name: "glob" },
        { name: "lsp" },
        { name: "todo" },
        { name: "bash" },
        { name: "edit" },
        { name: "write" },
        { name: "task" },
      ],
      contextUsage: {
        tokens: 1024,
        contextWindow: 200000,
        percent: 0.512,
      },
    });
    return;
  }
  if (command.type === "prompt") {
    if (command.message === "/advisor status") {
      advisorPending = true;
      const finish = () => {
        write({
          type: "command_output",
          text: "Advisor is enabled (openai-codex/gpt-5.6-sol). Context: 0 tokens. Spend: 0 input, 0 output, $0.0000.",
        });
        respond(command, { agentInvoked: false });
        advisorPending = false;
      };
      if (slowAdvisor) setTimeout(finish, 200);
      else finish();
      return;
    }
    if (advisorPending) {
      write({
        type: "response",
        id: command.id,
        command: command.type,
        success: false,
        error: "prompt overlapped advisor probe",
      });
      return;
    }
    if (hangPrompt) return;
    write({
      type: "agent_start",
    });
    write({
      type: "message_start",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Working" }],
      },
    });
    write({
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "read",
      args: { path: "AGENTS.md" },
    });
    write({
      type: "tool_execution_end",
      toolCallId: "tool-1",
      toolName: "read",
      result: { content: "ok" },
      isError: false,
    });
    write({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Working\n\nDone." }],
      },
    });
    write(
      approvalRequest
        ? {
            type: "extension_ui_request",
            id: "approval-1",
            method: "select",
            title: "Allow tool: bash",
            message: "Command: git status --short",
            options: ["Approve", "Deny"],
          }
        : {
            type: "extension_ui_request",
            id: "confirm-1",
            method: "confirm",
            title: "Continue?",
            message: "Exercise UI round trip",
          },
    );
    write({
      type: "agent_end",
    });
    respond(command, { accepted: true });
    return;
  }
  if (command.type === "late_fail_prompt") {
    respond(command, { accepted: true });
    setImmediate(() => {
      write({
        type: "response",
        id: command.id,
        command: command.type,
        success: false,
        code: "queue_rejected",
        error: "late queue rejection",
      });
    });
    return;
  }
  if (command.type === "extension_ui_response") {
    write({
      type: "extension_ui_ack",
      id: command.id,
      confirmed: command.confirmed,
    });
    return;
  }
  if (command.type === "shutdown") {
    respond(command, { accepted: true });
    input.close();
    setImmediate(() => process.exit(0));
    return;
  }
  respond(command, {});
});

function respond(command, data) {
  write({
    type: "response",
    id: command.id,
    command: command.type,
    success: true,
    data,
  });
}
