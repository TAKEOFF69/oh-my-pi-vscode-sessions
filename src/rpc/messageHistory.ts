import {
  RpcCommandError,
  type RpcResponse,
} from "./RpcProcess";

const PAGE_LIMIT = 200;
const MAX_PAGES = 10_000;

export type RpcRequester = {
  request(command: Record<string, unknown> & { type: string }): Promise<RpcResponse>;
};

export async function loadRpcMessageHistory(
  rpc: RpcRequester,
): Promise<RpcResponse> {
  const messages: unknown[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let expectedTotal: number | undefined;

  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await rpc.request({
        type: "get_messages_page",
        limit: PAGE_LIMIT,
        ...(cursor ? { cursor } : {}),
      });
      const data = isRecord(response.data) ? response.data : {};
      if (!Array.isArray(data.messages)) {
        throw new Error("get_messages_page returned no messages array");
      }
      messages.push(...data.messages);
      if (
        !Number.isSafeInteger(data.totalMessages) ||
        Number(data.totalMessages) < 0
      ) {
        throw new Error(
          "get_messages_page returned invalid totalMessages",
        );
      }
      const total = Number(data.totalMessages);
      if (expectedTotal !== undefined && expectedTotal !== total) {
        throw new Error("get_messages_page total changed during traversal");
      }
      expectedTotal = total;
      const nextCursor =
        typeof data.nextCursor === "string" && data.nextCursor
          ? data.nextCursor
          : undefined;
      if (!nextCursor) {
        if (
          messages.length !== expectedTotal
        ) {
          throw new Error(
            `get_messages_page expected ${expectedTotal} messages, received ${messages.length}`,
          );
        }
        return {
          type: "response",
          id: "vscode_message_history",
          command: "get_messages",
          success: true,
          data: { messages },
        };
      }
      if (seenCursors.has(nextCursor)) {
        throw new Error("get_messages_page repeated cursor");
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new Error(`get_messages_page exceeded ${MAX_PAGES} pages`);
  } catch (error) {
    if (
      error instanceof RpcCommandError &&
      (error.code === "session_busy" || error.code === "stale_cursor")
    ) {
      return rpc.request({ type: "get_messages" });
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
