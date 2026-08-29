import { describe, expect, it } from "vitest";

import { workspaceSnapshotSchema } from "@chief/relay-contracts";

import { decodeWorkspaceSnapshot } from "../src/workspace-defaults";

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

  it("still rejects a snapshot with a genuinely broken shape", () => {
    expect(() =>
      decodeWorkspaceSnapshot(JSON.stringify({ hello: "world" })),
    ).toThrow();
  });
});
