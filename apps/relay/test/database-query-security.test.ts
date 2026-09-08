import { expect, it } from "vitest";

import { getDeliveryExternalAgentOutbox } from "../src/queries/external-agent-outbox/get-delivery";
import { insertDeliveryExternalAgentOutbox } from "../src/queries/external-agent-outbox/insert-delivery";
import { withWorkspaceStorage } from "./sqlite-test-storage";

it("binds hostile values literally and keeps each agent's delivery distinct", async () =>
  withWorkspaceStorage((storage) => {
    const hostile = "eve'; DROP TABLE external_agent_outbox; --";
    const now = new Date().toISOString();
    for (const agent of [hostile, "other-agent"]) {
      insertDeliveryExternalAgentOutbox(storage, {
        agentId: agent,
        deliveryId: "same-delivery",
        payloadHash: "hash",
        payloadJson: JSON.stringify({ private: agent }),
        capabilityHash: agent,
        conversationId: "general",
        threadRootId: null,
        sessionAddress: "session",
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    const [first] = getDeliveryExternalAgentOutbox(
      storage,
      hostile,
      "same-delivery",
    );
    const [second] = getDeliveryExternalAgentOutbox(
      storage,
      "other-agent",
      "same-delivery",
    );
    expect(first?.agent_id).toBe(hostile);
    expect(second?.agent_id).toBe("other-agent");
    expect(
      getDeliveryExternalAgentOutbox(
        storage,
        "missing' OR 1=1 --",
        "same-delivery",
      ),
    ).toEqual([]);
  }));

it("does not expose bound content or credentials when SQLite rejects a write", async () =>
  withWorkspaceStorage((storage) => {
    const privatePayload = "sensitive-credential-value";
    const now = new Date().toISOString();
    const insert = () =>
      insertDeliveryExternalAgentOutbox(storage, {
        agentId: "eve",
        deliveryId: "duplicate",
        payloadHash: "hash",
        payloadJson: privatePayload,
        capabilityHash: "secret-capability",
        conversationId: "general",
        threadRootId: null,
        sessionAddress: "session",
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      });
    insert();
    try {
      insert();
      expect.fail("A duplicate delivery must be rejected.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 500,
        code: "database_operation_failed",
        message: "The database operation failed.",
      });
      expect(String(error)).not.toContain(privatePayload);
      expect(error).not.toHaveProperty("cause");
      expect(error).not.toHaveProperty("params");
    }
    expect(
      getDeliveryExternalAgentOutbox(storage, "eve", "duplicate"),
    ).toHaveLength(1);
  }));
