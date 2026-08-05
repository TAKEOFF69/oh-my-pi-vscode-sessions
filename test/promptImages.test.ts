import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PROMPT_IMAGE_BYTES,
  parsePromptImages,
  promptFrameFits,
} from "../src/promptImages";

test("prompt image validator accepts canonical bounded OMP image content", () => {
  const image = {
    type: "image",
    mimeType: "image/png",
    data: "iVBORw==",
  } as const;
  assert.deepEqual(parsePromptImages([image]), [image]);
  assert.equal(promptFrameFits("Inspect screenshot", [image]), true);
});

test("prompt image validator rejects data URLs, unsafe MIME, and total overflow", () => {
  assert.equal(
    parsePromptImages([
      { type: "image", mimeType: "image/png", data: "data:image/png;base64,AA==" },
    ]),
    null,
  );
  assert.equal(
    parsePromptImages([
      { type: "image", mimeType: "image/svg+xml", data: "PHN2Zz4=" },
    ]),
    null,
  );
  const oversized = Buffer.alloc(MAX_PROMPT_IMAGE_BYTES + 1).toString("base64");
  assert.equal(
    parsePromptImages([
      { type: "image", mimeType: "image/png", data: oversized },
    ]),
    null,
  );
});
