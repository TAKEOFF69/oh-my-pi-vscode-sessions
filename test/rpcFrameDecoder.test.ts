import assert from "node:assert/strict";
import test from "node:test";

import { RpcFrameDecoder } from "../src/rpc/frameDecoder";

const CHUNKED_BYTE_LENGTH = 1024 * 1024;

test("RPC decoder handles split and coalesced JSONL frames", () => {
  const decoder = new RpcFrameDecoder();
  assert.deepEqual(decoder.push('{"type":"rea'), []);
  assert.deepEqual(
    decoder.push('dy"}\n{"type":"agent_start"}\n'),
    [{ type: "ready" }, { type: "agent_start" }],
  );
});

test("RPC decoder reassembles protocol-v2 chunks losslessly", () => {
  const decoder = new RpcFrameDecoder();
  decoder.enableProtocolV2();
  const text = `zażółć${"x".repeat(CHUNKED_BYTE_LENGTH)}`;
  const payload = Buffer.from(
    JSON.stringify({
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
      },
    }),
    "utf8",
  );
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < payload.length; offset += 256 * 1024) {
    chunks.push(payload.subarray(offset, offset + 256 * 1024));
  }
  const lines = chunks.map((chunk, index) =>
    JSON.stringify({
      type: "rpc_chunk",
      chunkId: "rpc-1",
      index,
      count: chunks.length,
      byteLength: payload.length,
      data: chunk.toString("base64"),
    }),
  );

  for (const line of lines.slice(0, -1)) {
    assert.deepEqual(decoder.push(`${line}\n`), []);
  }
  const frames = decoder.push(`${lines.at(-1)}\n`) as Array<{
    message: { content: Array<{ text: string }> };
  }>;
  assert.equal(frames.length, 1);
  assert.equal(frames[0]?.message.content[0]?.text, text);
});

test("RPC decoder rejects interrupted, reordered, and malformed chunks", () => {
  const reordered = new RpcFrameDecoder();
  reordered.enableProtocolV2();
  assert.throws(
    () =>
      reordered.push(
        `${JSON.stringify({
          type: "rpc_chunk",
          chunkId: "rpc-1",
          index: 1,
          count: 4,
          byteLength: CHUNKED_BYTE_LENGTH,
          data: "e30=",
        })}\n`,
      ),
    /starts at index 1/,
  );

  const interrupted = new RpcFrameDecoder();
  interrupted.enableProtocolV2();
  interrupted.push(
    `${JSON.stringify({
      type: "rpc_chunk",
      chunkId: "rpc-1",
      index: 0,
      count: 4,
      byteLength: CHUNKED_BYTE_LENGTH,
      data: "ew==",
    })}\n`,
  );
  assert.throws(
    () => interrupted.push('{"type":"agent_start"}\n'),
    /was interrupted/,
  );

  const malformed = new RpcFrameDecoder();
  malformed.enableProtocolV2();
  assert.throws(
    () =>
      malformed.push(
        `${JSON.stringify({
          type: "rpc_chunk",
          chunkId: "rpc-1",
          index: 0,
          count: 4,
          byteLength: CHUNKED_BYTE_LENGTH,
          data: "***=",
        })}\n`,
      ),
    /base64/,
  );
});

test("RPC decoder rejects oversized physical frames and unfinished sequences", () => {
  const decoder = new RpcFrameDecoder();
  assert.throws(
    () =>
      decoder.push(
        `{"type":"notice","message":"${"x".repeat(CHUNKED_BYTE_LENGTH)}"}`,
      ),
    /physical frame exceeds/,
  );

  const unfinished = new RpcFrameDecoder();
  unfinished.enableProtocolV2();
  unfinished.push(
    `${JSON.stringify({
      type: "rpc_chunk",
      chunkId: "rpc-2",
      index: 0,
      count: 4,
      byteLength: CHUNKED_BYTE_LENGTH,
      data: "ew==",
    })}\n`,
  );
  assert.throws(() => unfinished.end(), /ended at 1\/4/);
});

test("RPC decoder rejects chunks before v2 negotiation", () => {
  const decoder = new RpcFrameDecoder();
  assert.throws(
    () =>
      decoder.push(
        `${JSON.stringify({
          type: "rpc_chunk",
          chunkId: "rpc-early",
          index: 0,
          count: 2,
          byteLength: 2,
          data: "ew==",
        })}\n`,
      ),
    /before protocol v2 negotiation/,
  );
});

test("RPC decoder bounds buffered remainder and chunk metadata", () => {
  const remainder = new RpcFrameDecoder();
  assert.throws(
    () =>
      remainder.push(
        `{"type":"ready"}\n${"x".repeat(CHUNKED_BYTE_LENGTH + 1)}`,
      ),
    /physical frame exceeds/,
  );

  const hugeCount = new RpcFrameDecoder();
  hugeCount.enableProtocolV2();
  assert.throws(
    () =>
      hugeCount.push(
        `${JSON.stringify({
          type: "rpc_chunk",
          chunkId: "rpc-many",
          index: 0,
          count: 100_000_000,
          byteLength: CHUNKED_BYTE_LENGTH,
          data: "ew==",
        })}\n`,
      ),
    /Malformed RPC chunk frame/,
  );

  const empty = new RpcFrameDecoder();
  empty.enableProtocolV2();
  assert.throws(
    () =>
      empty.push(
        `${JSON.stringify({
          type: "rpc_chunk",
          chunkId: "rpc-empty",
          index: 0,
          count: 4,
          byteLength: CHUNKED_BYTE_LENGTH,
          data: "",
        })}\n`,
      ),
    /Malformed RPC chunk frame/,
  );

  const oversizedChunk = new RpcFrameDecoder();
  oversizedChunk.enableProtocolV2();
  assert.throws(
    () =>
      oversizedChunk.push(
        `${JSON.stringify({
          type: "rpc_chunk",
          chunkId: "rpc-wide",
          index: 0,
          count: 5,
          byteLength: CHUNKED_BYTE_LENGTH + 4,
          data: Buffer.alloc(256 * 1024 + 1).toString("base64"),
        })}\n`,
      ),
    /1-262144 decoded bytes/,
  );
});

test("RPC decoder rejects malformed and incomplete UTF-8", () => {
  const malformed = new RpcFrameDecoder();
  assert.throws(
    () =>
      malformed.push(
        Buffer.from([0x7b, 0x22, 0x80, 0x22, 0x7d, 0x0a]),
      ),
    /not valid UTF-8/,
  );

  const incomplete = new RpcFrameDecoder();
  incomplete.push(Buffer.from([0x7b, 0x22, 0xe2]));
  assert.throws(() => incomplete.end(), /invalid UTF-8/);
});
