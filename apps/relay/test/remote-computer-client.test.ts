import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { RecoverableToolError } from "@chief/agent-runtime/durable-turn";
import { agentJobSchema } from "@chief/relay-contracts";

import { RemoteComputerClient } from "../src/remote-computer-client";

describe("RemoteComputerClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("marks executor input rejection as recoverable before execution", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "invalid_request",
              message: "Executor request is invalid.",
              requestId: crypto.randomUUID(),
            },
          },
          { status: 400 },
        ),
      ),
    );
    const client = new RemoteComputerClient(
      "http://computer.test",
      "test-secret",
      testJob(),
    );

    await expect(
      client.json("/v1/exec", z.unknown(), {
        argv: ["echo", "hello"],
        cwd: ".",
        timeoutMillis: 30_000,
      }),
    ).rejects.toBeInstanceOf(RecoverableToolError);
  });
});

function testJob() {
  const now = new Date().toISOString();
  return agentJobSchema.parse({
    id: crypto.randomUUID(),
    workspaceId: "workspace-a",
    agentId: "prospector",
    kind: "conversation.message",
    payload: {},
    status: "leased",
    attempt: 1,
    lastError: null,
    availableAt: now,
    leaseExpiresAt: now,
    createdAt: now,
    updatedAt: now,
  });
}
