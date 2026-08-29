import { describe, expect, it, vi } from "vitest";

import {
  releaseInternalResponse,
  requireInternalResponse,
} from "../src/internal-response";

describe("internal response lifecycle", () => {
  it("cancels an unread internal response body", async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        cancel,
      }),
    );

    await releaseInternalResponse(response);

    expect(cancel).toHaveBeenCalledOnce();
  });

  it("releases a failed response before reporting the operation failure", async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        cancel,
      }),
      { status: 503 },
    );

    await expect(
      requireInternalResponse(response, "Internal request failed."),
    ).rejects.toThrow("Internal request failed.");
    expect(cancel).toHaveBeenCalledOnce();
  });
});
