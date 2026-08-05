import {
  MAX_PROMPT_IMAGE_BYTES,
  PROMPT_IMAGE_MIME_TYPES,
  type PromptImage,
} from "./promptImages";

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_EDGE = 1568;

export function pastedImageFiles(event: ClipboardEvent): File[] {
  return [...(event.clipboardData?.items ?? [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

export async function preparePromptImage(
  file: File,
  byteBudget = MAX_PROMPT_IMAGE_BYTES,
): Promise<PromptImage> {
  if (
    !PROMPT_IMAGE_MIME_TYPES.includes(
      file.type as PromptImage["mimeType"],
    )
  ) {
    throw new Error("Paste PNG, JPEG, WebP, or GIF images.");
  }
  if (file.size <= 0 || file.size > MAX_SOURCE_BYTES) {
    throw new Error("Pasted image must be smaller than 25 MiB.");
  }
  if (byteBudget <= 0) {
    throw new Error("Screenshot attachment limit reached.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= byteBudget) {
      return {
        type: "image",
        mimeType: file.type as PromptImage["mimeType"],
        data: await blobToBase64(file),
      };
    }

    let width = Math.max(1, Math.round(bitmap.width * scale));
    let height = Math.max(1, Math.round(bitmap.height * scale));
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Image canvas is unavailable.");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);

      const preferred =
        attempt === 0 && file.type === "image/png"
          ? await canvasBlob(canvas, "image/png")
          : await canvasBlob(
              canvas,
              "image/jpeg",
              Math.max(0.62, 0.9 - attempt * 0.06),
            );
      if (preferred.size <= byteBudget) {
        return {
          type: "image",
          mimeType: preferred.type as PromptImage["mimeType"],
          data: await blobToBase64(preferred),
        };
      }
      width = Math.max(200, Math.round(width * 0.82));
      height = Math.max(200, Math.round(height * 0.82));
    }
    throw new Error("Screenshot is too large after safe resizing.");
  } finally {
    bitmap.close();
  }
}

async function canvasBlob(
  canvas: HTMLCanvasElement,
  mimeType: "image/png" | "image/jpeg",
  quality?: number,
): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Could not encode pasted screenshot.")),
      mimeType,
      quality,
    );
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}
