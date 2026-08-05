export const MAX_PROMPT_IMAGES = 4;
export const MAX_PROMPT_IMAGE_BYTES = 500 * 1024;
export const MAX_PROMPT_FRAME_BYTES = 960 * 1024;

export const PROMPT_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export type PromptImage = {
  type: "image";
  data: string;
  mimeType: (typeof PROMPT_IMAGE_MIME_TYPES)[number];
};

export type PromptDraft = {
  message: string;
  images: PromptImage[];
};

export function parsePromptImages(raw: unknown): PromptImage[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_PROMPT_IMAGES) return null;

  const images: PromptImage[] = [];
  let totalBytes = 0;
  for (const value of raw) {
    if (!isRecord(value) || value.type !== "image") return null;
    if (
      typeof value.mimeType !== "string" ||
      !PROMPT_IMAGE_MIME_TYPES.includes(
        value.mimeType as PromptImage["mimeType"],
      ) ||
      typeof value.data !== "string"
    ) {
      return null;
    }
    const bytes = decodedBase64Bytes(value.data);
    if (bytes === null || bytes === 0) return null;
    totalBytes += bytes;
    if (totalBytes > MAX_PROMPT_IMAGE_BYTES) return null;
    images.push({
      type: "image",
      data: value.data,
      mimeType: value.mimeType as PromptImage["mimeType"],
    });
  }
  return images;
}

export function promptFrameFits(
  message: string,
  images: readonly PromptImage[],
): boolean {
  return new TextEncoder().encode(
    JSON.stringify({ type: "prompt", message, images }),
  ).byteLength <= MAX_PROMPT_FRAME_BYTES;
}

export function decodedBase64Bytes(data: string): number | null {
  if (
    data.length === 0 ||
    data.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      data,
    )
  ) {
    return null;
  }
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
