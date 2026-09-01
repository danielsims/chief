import { describe, expect, it } from "vitest";

import { workspaceSnapshotSchema } from "@chief/relay-contracts";

import { decodeWorkspaceSnapshot } from "../src/workspace-defaults";
import { reconcileExternalAgentSnapshot } from "../src/workspace-external-agent-snapshot";

const valid = workspaceSnapshotSchema.parse({
  id: "workspace-00000000-0000-4000-8000-000000000001",
  name: "Acme",
  createdAt: "2026-08-25T00:00:00.000Z",
  imageURL: null,
  onboardingComplete: true,
  conversations: [],
  agents: [
    { id: "chief", name: "Chief", role: "Chief of staff", status: "idle" },
  ],
  projects: [],
});

describe("workspace snapshot decode", () => {
  it("passes a clean snapshot through unchanged", () => {
    const decoded = decodeWorkspaceSnapshot(JSON.stringify(valid));
    expect(decoded.runtime).toBeNull();
  });

  it("normalizes a stale runtime to null instead of bricking the workspace", () => {
    const stale = { ...valid, runtime: "cloudflare" };
    const decoded = decodeWorkspaceSnapshot(JSON.stringify(stale));
    expect(decoded.runtime).toBeNull();
    expect(decoded.name).toBe("Acme");
    expect(decoded.agents.some((agent) => agent.id === "chief")).toBe(true);
  });

  it("normalizes a stale runtime and preserves the intended enum value", () => {
    const stale = { ...valid, runtime: "cloud" };
    const decoded = decodeWorkspaceSnapshot(JSON.stringify(stale));
    expect(decoded.runtime).toBe("cloud");
  });

  it("normalizes an unknown stored project provider without bricking the workspace", () => {
    const stale = {
      ...valid,
      projects: [
        {
          id: "project-1",
          organizationId: valid.id,
          name: "Existing project",
          repositoryKind: "cloned",
          providerId: "chief-cloud",
          canonicalRemoteUrl: "https://example.com/owner/repository.git",
          defaultBranch: "main",
          createdAt: "2026-08-31T00:00:00.000Z",
          updatedAt: "2026-08-31T00:00:00.000Z",
        },
      ],
    };

    const decoded = decodeWorkspaceSnapshot(JSON.stringify(stale));

    expect(decoded.projects[0]?.providerId).toBe("generic-git");
  });

  it("restores Eve runtime metadata from its authoritative registration", () => {
    const reconciled = reconcileExternalAgentSnapshot(valid, [
      {
        agent_id: "chief",
        endpoint_url: "https://chief-eve.vercel.app/channels/chief/messages",
        connection_status: "connected",
        registration_result_json: JSON.stringify({
          agent: {
            id: "chief",
            name: "Chief",
            role: "Chief of staff",
            status: "idle",
            runtime: {
              kind: "external-channel",
              provider: "eve",
              endpoint: "https://stale.vercel.app/channels/chief/messages",
              connectionStatus: "pending_setup",
              deployment: { status: "unattested" },
            },
          },
        }),
      },
    ]);

    expect(reconciled.changed).toBe(true);
    expect(reconciled.snapshot.agents[0]?.runtime).toMatchObject({
      kind: "external-channel",
      provider: "eve",
      endpoint: "https://chief-eve.vercel.app/channels/chief/messages",
      connectionStatus: "connected",
    });
  });

  it("still rejects a snapshot with a genuinely broken shape", () => {
    expect(() =>
      decodeWorkspaceSnapshot(JSON.stringify({ hello: "world" })),
    ).toThrow();
  });
});
