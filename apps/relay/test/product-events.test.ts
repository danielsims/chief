import { afterEach, describe, expect, it, vi } from "vitest";

import { userIdSchema, workspaceIdSchema } from "@chief/relay-contracts";

import { recordProductEvents } from "../src/product-events";

describe("recordProductEvents", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits structured deployment events without relay storage", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const env = {
      RELAY_ID: "relay-test",
      RELAY_DEPLOYMENT: "self-hosted",
    } satisfies Pick<Env, "RELAY_ID" | "RELAY_DEPLOYMENT">;

    recordProductEvents(env, ["signup", "workspace-created"], {
      kind: "user",
      userId: userIdSchema.parse("user-test"),
      pubkey: "0".repeat(64),
      workspaceId: workspaceIdSchema.parse("workspace-test"),
      role: "owner",
    });

    expect(info).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenNthCalledWith(
      1,
      "[relay-product-event]",
      JSON.stringify({
        scope: "relay.product",
        event: "signup",
        relayId: "relay-test",
        deployment: "self-hosted",
        workspaceId: "workspace-test",
        userId: "user-test",
      }),
    );
  });
});
