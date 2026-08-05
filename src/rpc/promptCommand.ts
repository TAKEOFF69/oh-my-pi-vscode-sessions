import type { PromptImage } from "../promptImages";

export function buildRpcPromptCommand(
  type: "prompt" | "steer" | "follow_up",
  id: string,
  message: string,
  images: readonly PromptImage[],
  streaming: boolean,
): Record<string, unknown> & { type: string } {
  return type === "prompt"
    ? {
        type: "prompt",
        id,
        message,
        ...(images.length > 0 ? { images } : {}),
        ...(streaming ? { streamingBehavior: "followUp" } : {}),
      }
    : {
        type,
        id,
        message,
        ...(images.length > 0 ? { images } : {}),
      };
}
