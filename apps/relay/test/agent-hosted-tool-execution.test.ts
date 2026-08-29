import { describe, expect, it, vi } from "vitest";

import { runHostedToolWithDeadline } from "../src/agent-hosted-tool-execution";

describe("runHostedToolWithDeadline", () => {
  it("releases the hosted browser and rejects when a tool exceeds its deadline", async () => {
    vi.useFakeTimers();
    const release = vi.fn().mockResolvedValue(undefined);
    const pending = runHostedToolWithDeadline(
      () => new Promise<never>(() => undefined),
      release,
      50,
    );
    const rejection = expect(pending).rejects.toThrow(
      "Hosted tool exceeded 50ms",
    );

    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(release).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
