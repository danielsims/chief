import { describe, expect, it } from "vitest";

import {
  apnsReady,
  conversationPushUrl,
  sendApnsAlert,
} from "../src/apns-client";

describe("APNs client", () => {
  it("is a no-op when Apple credentials are missing", async () => {
    expect(apnsReady({})).toBe(false);
    expect(
      await sendApnsAlert(
        {},
        {
          token: "a".repeat(64),
          environment: "sandbox",
          title: "Engineer",
          body: "Ready when you are.",
          workspaceId: "workspace-a",
          conversationId: "engineering",
        },
      ),
    ).toBe(0);
  });

  it("is ready only when the signing key, key id, and team id are present", () => {
    expect(
      apnsReady({
        APNS_P8: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
        APNS_KEY_ID: "KEYID123",
        APNS_TEAM_ID: "TEAMID123",
      }),
    ).toBe(true);
  });

  it("encodes a tap destination the mobile app can open", () => {
    expect(
      conversationPushUrl({
        workspaceId: "workspace-a",
        conversationId: "marketing",
        threadRootId: "root-1",
      }),
    ).toBe(
      "chief-mobile://conversation?workspace=workspace-a&channel=marketing&thread=root-1",
    );
  });
});
