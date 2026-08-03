import assert from "node:assert/strict";
import test from "node:test";

import { authorizeOrganizationRole } from "../src/organization-authorization";

function memberResponse(role: string, organizationId = "workspace-a") {
  return () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          id: "member-1",
          organizationId,
          role,
          userId: "u-1",
        }),
        { status: 200 },
      ),
    );
}

void test("organization role authorization accepts owners and admins", async () => {
  const common = {
    apiBaseUrl: "https://chief.example.com/agent-tools/whoami",
    allowedRoles: ["owner", "admin"] as const,
    errorMessage: "Only admins.",
    sessionToken: "session-token",
    workspaceId: "workspace-a",
  };
  assert.equal(
    await authorizeOrganizationRole({
      ...common,
      fetcher: memberResponse("admin"),
    }),
    "admin",
  );
  assert.equal(
    await authorizeOrganizationRole({
      ...common,
      fetcher: memberResponse("member,owner"),
    }),
    "owner",
  );
});

void test("organization role authorization fails closed", async () => {
  const common = {
    apiBaseUrl: "https://chief.example.com",
    allowedRoles: ["owner", "admin"] as const,
    errorMessage: "Only admins.",
    sessionToken: "session-token",
    workspaceId: "workspace-a",
  };
  await assert.rejects(
    authorizeOrganizationRole({ ...common, fetcher: memberResponse("member") }),
    /Only admins/u,
  );
  await assert.rejects(
    authorizeOrganizationRole({
      ...common,
      fetcher: memberResponse("owner", "workspace-b"),
    }),
    /Only admins/u,
  );
});
