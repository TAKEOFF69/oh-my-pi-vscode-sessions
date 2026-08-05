import assert from "node:assert/strict";
import test from "node:test";

import { pastedImageFiles } from "../src/imagePaste";

test("clipboard files fallback accepts screenshots when items are absent", () => {
  const screenshot = new File([new Uint8Array([1])], "shot.png", { type: "image/png" });
  const text = new File(["x"], "note.txt", { type: "text/plain" });
  const files = pastedImageFiles({
    clipboardData: { items: [] as unknown as DataTransferItemList, files: [screenshot, text] as unknown as FileList } as DataTransfer,
  });
  assert.deepEqual(files, [screenshot]);
});

test("clipboard item and files views are deduplicated", () => {
  const screenshot = new File([new Uint8Array([1])], "shot.png", { type: "image/png" });
  const files = pastedImageFiles({
    clipboardData: {
      items: [{ kind: "file", type: "image/png", getAsFile: () => screenshot }] as unknown as DataTransferItemList,
      files: [screenshot] as unknown as FileList,
    } as DataTransfer,
  });
  assert.deepEqual(files, [screenshot]);
});
