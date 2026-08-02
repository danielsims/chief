import assert from "node:assert/strict";
import test from "node:test";

import { imageAttachmentError } from "../src/components/chat/composer-image-attachments.js";

void test("accepts supported composer images within the upload limit", () => {
  assert.equal(
    imageAttachmentError({ type: "image/png", size: 2 * 1024 * 1024 }),
    undefined,
  );
});

void test("rejects unsupported or oversized composer attachments", () => {
  assert.match(
    imageAttachmentError({ type: "application/pdf", size: 128 }) ?? "",
    /PNG, JPEG, WebP, or GIF/u,
  );
  assert.match(
    imageAttachmentError({ type: "image/jpeg", size: 9 * 1024 * 1024 }) ?? "",
    /smaller than 8 MB/u,
  );
});
