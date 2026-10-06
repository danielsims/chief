import assert from "node:assert/strict";
import test from "node:test";

import {
  invitationDeepLink,
  invitationPath,
  isChannelId,
  isWorkspaceId,
  safeRelayOrigin,
} from "./invitation-links";

void test("safeRelayOrigin accepts https and loopback http only", () => {
  assert.equal(
    safeRelayOrigin("https://relay.heychief.sh"),
    "https://relay.heychief.sh",
  );
  assert.equal(
    safeRelayOrigin("http://localhost:8787"),
    "http://localhost:8787",
  );
  assert.equal(
    safeRelayOrigin("http://127.0.0.1:8787"),
    "http://127.0.0.1:8787",
  );
  for (const value of [
    "http://relay.example.com",
    "https://user:pass@relay.example.com",
    "https://relay.example.com#fragment",
    "https://relay.example.com/extra",
    "ftp://relay.example.com",
    "not a url",
  ]) {
    assert.equal(safeRelayOrigin(value), null, value);
  }
});

void test("invitationPath carries relay, workspace, and channel", () => {
  assert.equal(
    invitationPath({
      id: "invite-1",
      relay: "https://relay.test",
      workspace: "workspace-1",
    }),
    "/invitations/invite-1?relay=https%3A%2F%2Frelay.test&workspace=workspace-1",
  );
  assert.match(
    invitationPath({
      id: "invite/2",
      relay: "https://relay.test",
      workspace: "workspace-1",
      channel: "channel-9",
    }),
    /^\/invitations\/invite%2F2\?relay=/,
  );
});

void test("invitationDeepLink adds channel only when present", () => {
  assert.equal(
    invitationDeepLink("chief-desktop", {
      relay: "https://relay.test",
      workspace: "workspace-1",
    }),
    "chief-desktop://organization-invite?relay=https%3A%2F%2Frelay.test&workspace=workspace-1",
  );
  assert.equal(
    invitationDeepLink("chief-mobile", {
      relay: "https://relay.test",
      workspace: "workspace-1",
      channel: "channel-9",
    }),
    "chief-mobile://organization-invite?relay=https%3A%2F%2Frelay.test&workspace=workspace-1&channel=channel-9",
  );
});

void test("workspace and channel identifiers are validated", () => {
  assert.equal(isWorkspaceId("workspace-0e1f"), true);
  assert.equal(isWorkspaceId("0e1f"), false);
  assert.equal(isWorkspaceId("workspace-"), false);
  assert.equal(isChannelId("channel-1"), true);
  assert.equal(isChannelId("has spaces"), false);
});
