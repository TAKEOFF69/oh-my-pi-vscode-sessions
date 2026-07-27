export const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
export const DEFAULT_MAX_REASSEMBLED_BYTES = 64 * 1024 * 1024;
export const MAX_RPC_CHUNKS = 256;
export const MAX_DECODED_CHUNK_BYTES = 256 * 1024;

type ChunkFrame = {
  type: "rpc_chunk";
  chunkId: string;
  index: number;
  count: number;
  byteLength: number;
  data: string;
};

type ChunkAssembly = {
  id: string;
  count: number;
  byteLength: number;
  nextIndex: number;
  chunks: Buffer[];
  receivedBytes: number;
};

export class RpcFrameDecoder {
  readonly #decoder = new TextDecoder("utf-8", { fatal: true });
  #lineBuffer = "";
  #assembly: ChunkAssembly | undefined;
  #maxFrameBytes = DEFAULT_MAX_FRAME_BYTES;
  #maxReassembledBytes = DEFAULT_MAX_REASSEMBLED_BYTES;
  #protocolV2Enabled = false;
  #protocolV2NegotiationPending = false;

  enableProtocolV2(): void {
    this.#protocolV2Enabled = true;
    this.#protocolV2NegotiationPending = false;
  }

  beginProtocolV2Negotiation(): void {
    this.#protocolV2NegotiationPending = true;
  }

  push(chunk: Buffer | Uint8Array | string): unknown[] {
    let text: string;
    try {
      text =
        typeof chunk === "string"
          ? chunk
          : this.#decoder.decode(Buffer.from(chunk), { stream: true });
    } catch {
      throw new Error("RPC stream is not valid UTF-8");
    }
    this.#lineBuffer += text;
    if (
      !this.#lineBuffer.includes("\n") &&
      Buffer.byteLength(this.#lineBuffer, "utf8") > this.#maxFrameBytes
    ) {
      throw new Error(
        `RPC physical frame exceeds ${this.#maxFrameBytes} bytes`,
      );
    }

    const frames: unknown[] = [];
    let newline = this.#lineBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.#lineBuffer.slice(0, newline).replace(/\r$/, "");
      this.#lineBuffer = this.#lineBuffer.slice(newline + 1);
      if (line.trim()) {
        const decoded = this.#decodeLine(line);
        if (decoded !== undefined) {
          frames.push(decoded);
        }
      }
      newline = this.#lineBuffer.indexOf("\n");
    }
    if (Buffer.byteLength(this.#lineBuffer, "utf8") > this.#maxFrameBytes) {
      throw new Error(
        `RPC physical frame exceeds ${this.#maxFrameBytes} bytes`,
      );
    }
    return frames;
  }

  end(): unknown[] {
    try {
      this.#lineBuffer += this.#decoder.decode();
    } catch {
      throw new Error("RPC stream ended with invalid UTF-8");
    }
    const frames: unknown[] = [];
    if (this.#lineBuffer.trim()) {
      const decoded = this.#decodeLine(this.#lineBuffer.replace(/\r$/, ""));
      if (decoded !== undefined) {
        frames.push(decoded);
      }
    }
    this.#lineBuffer = "";
    if (this.#assembly) {
      throw new Error(
        `RPC chunk sequence ${this.#assembly.id} ended at ${this.#assembly.nextIndex}/${this.#assembly.count}`,
      );
    }
    return frames;
  }

  #decodeLine(line: string): unknown | undefined {
    if (Buffer.byteLength(line, "utf8") > this.#maxFrameBytes) {
      throw new Error(
        `RPC physical frame exceeds ${this.#maxFrameBytes} bytes`,
      );
    }

    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Invalid RPC JSON frame: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (isReadyFrame(frame)) {
      if (
        positiveInteger(frame.maxFrameBytes) &&
        frame.maxFrameBytes <= DEFAULT_MAX_FRAME_BYTES
      ) {
        this.#maxFrameBytes = frame.maxFrameBytes;
      }
      if (
        positiveInteger(frame.maxReassembledFrameBytes) &&
        frame.maxReassembledFrameBytes <= DEFAULT_MAX_REASSEMBLED_BYTES
      ) {
        this.#maxReassembledBytes = frame.maxReassembledFrameBytes;
      }
    }
    if (
      this.#protocolV2NegotiationPending &&
      isProtocolV2NegotiationResponse(frame)
    ) {
      this.enableProtocolV2();
    }

    if (isChunkFrame(frame)) {
      if (!this.#protocolV2Enabled) {
        throw new Error("RPC chunk received before protocol v2 negotiation");
      }
      return this.#acceptChunk(frame);
    }
    if (this.#assembly) {
      throw new Error(
        `RPC chunk sequence ${this.#assembly.id} was interrupted`,
      );
    }
    return frame;
  }

  #acceptChunk(frame: ChunkFrame): unknown | undefined {
    validateChunkFrame(frame, this.#maxReassembledBytes);
    if (!this.#assembly) {
      if (frame.index !== 0) {
        throw new Error(`RPC chunk sequence starts at index ${frame.index}`);
      }
      this.#assembly = {
        id: frame.chunkId,
        count: frame.count,
        byteLength: frame.byteLength,
        nextIndex: 0,
        chunks: [],
        receivedBytes: 0,
      };
    }

    const assembly = this.#assembly;
    if (
      frame.chunkId !== assembly.id ||
      frame.count !== assembly.count ||
      frame.byteLength !== assembly.byteLength ||
      frame.index !== assembly.nextIndex
    ) {
      throw new Error(
        `Invalid RPC chunk ordering for ${frame.chunkId}: expected ${assembly.id}#${assembly.nextIndex}/${assembly.count}`,
      );
    }

    const bytes = decodeBase64(frame.data);
    if (
      bytes.length === 0 ||
      bytes.length > MAX_DECODED_CHUNK_BYTES
    ) {
      throw new Error(
        `RPC chunk payload must be 1-${MAX_DECODED_CHUNK_BYTES} decoded bytes`,
      );
    }
    assembly.chunks.push(bytes);
    assembly.receivedBytes += bytes.length;
    assembly.nextIndex += 1;
    if (assembly.receivedBytes > assembly.byteLength) {
      throw new Error(`RPC chunk sequence ${assembly.id} exceeded byteLength`);
    }
    if (assembly.nextIndex < assembly.count) {
      return undefined;
    }

    this.#assembly = undefined;
    if (assembly.receivedBytes !== assembly.byteLength) {
      throw new Error(
        `RPC chunk sequence ${assembly.id} expected ${assembly.byteLength} bytes, received ${assembly.receivedBytes}`,
      );
    }
    const payload = Buffer.concat(assembly.chunks);
    let json: string;
    try {
      json = new TextDecoder("utf-8", { fatal: true }).decode(payload);
    } catch {
      throw new Error(`RPC chunk sequence ${assembly.id} is not valid UTF-8`);
    }
    try {
      return JSON.parse(json);
    } catch (error) {
      throw new Error(
        `RPC chunk sequence ${assembly.id} contains invalid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function isReadyFrame(
  value: unknown,
): value is {
  type: "ready";
  maxFrameBytes?: number;
  maxReassembledFrameBytes?: number;
} {
  return isRecord(value) && value.type === "ready";
}

function isChunkFrame(value: unknown): value is ChunkFrame {
  return isRecord(value) && value.type === "rpc_chunk";
}

function isProtocolV2NegotiationResponse(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === "response" &&
    value.command === "negotiate_protocol" &&
    value.success === true &&
    isRecord(value.data) &&
    value.data.protocolVersion === 2
  );
}

function validateChunkFrame(
  frame: ChunkFrame,
  maxReassembledBytes: number,
): void {
  if (
    typeof frame.chunkId !== "string" ||
    !frame.chunkId ||
    frame.chunkId.length > 128 ||
    !nonNegativeInteger(frame.index) ||
    !positiveInteger(frame.count) ||
    frame.count < 2 ||
    frame.count > MAX_RPC_CHUNKS ||
    frame.index >= frame.count ||
    !positiveInteger(frame.byteLength) ||
    frame.byteLength < DEFAULT_MAX_FRAME_BYTES ||
    frame.byteLength > maxReassembledBytes ||
    frame.count > frame.byteLength ||
    typeof frame.data !== "string" ||
    !frame.data
  ) {
    throw new Error("Malformed RPC chunk frame");
  }
}

function decodeBase64(value: string): Buffer {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new Error("Malformed RPC chunk base64 payload");
  }
  return Buffer.from(value, "base64");
}

function positiveInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function nonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
