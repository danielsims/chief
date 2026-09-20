import { describe, expect, it } from "vitest";
import { z } from "zod";

import { RecoverableToolError } from "@chief/agent-runtime/durable-turn";

import {
  hostedDurableTools,
  parseRecoverableHostedToolError,
} from "../src/hosted-agent-tools";
import { HttpError } from "../src/http";

describe("hosted workspace file writes", () => {
  it("treats files.write as retryable instead of pausing the turn", () => {
    const write = hostedDurableTools({
      browserEnabled: false,
      computerEnabled: false,
    }).find((tool) => tool.definition.name === "files_write");

    expect(write?.effect).toBe("idempotent");
  });

  it("returns known 4xx failures to the agent instead of pausing", () => {
    const error = parseRecoverableHostedToolError(
      new HttpError(
        409,
        "workspace_file_version_conflict",
        "This file changed since it was opened.",
      ),
    );
    expect(error).toBeInstanceOf(RecoverableToolError);
    expect(error.message).toBe("This file changed since it was opened.");
  });

  it("returns schema failures to the agent instead of pausing", () => {
    const parsed = z.object({ conversationId: z.string() }).safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const error = parseRecoverableHostedToolError(parsed.error);
    expect(error).toBeInstanceOf(RecoverableToolError);
    expect(error.message.length).toBeGreaterThan(0);
  });

  it("keeps 5xx failures ambiguous for non-replayable tools", () => {
    const failure = new HttpError(
      500,
      "internal",
      "Workspace operation data-file-save failed.",
    );
    expect(parseRecoverableHostedToolError(failure)).toBe(failure);
  });
});
