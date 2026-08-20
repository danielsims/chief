import { describe, expect, it } from "vitest";

import { agentIdSchema } from "@chief/relay-contracts";

import { withTrustedContext } from "../src/internal-context";
import { registerTestAgent, setupChannelTest } from "./channel-test-helpers";
import { hexKey } from "./helpers";

describe("workspace data", () => {
  it("persists an agent-authored brand profile as shared context and a versioned file", async () => {
    const ctx = await setupChannelTest();
    const brandId = agentIdSchema.parse("brand");
    const pubkey = hexKey("workspace-data-brand");
    await registerTestAgent(ctx, brandId, pubkey);
    const brand = {
      kind: "agent" as const,
      agentId: brandId,
      pubkey,
      workspaceId: ctx.workspaceId,
    };

    const saved = await rpc(ctx, brand, "data-brand-save", {
      markdown: "# Brand profile\n\nEvidence-backed positioning.",
      sourceUrls: ["https://heychief.sh/"],
      conversationId: "marketing",
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      profile: { version: 1, authorAgentId: "brand" },
      file: { id: "brand-profile", path: "brand/profile.md", version: 1 },
    });

    const profile = await rpc(ctx, ctx.principal, "data-brand-get");
    expect(profile.status).toBe(200);
    expect(await profile.json()).toMatchObject({
      markdown: expect.stringContaining("Evidence-backed"),
      sourceUrls: ["https://heychief.sh/"],
    });

    const files = await rpc(ctx, ctx.principal, "data-files-list");
    expect(await files.json()).toMatchObject({
      files: [expect.objectContaining({ title: "Brand profile" })],
    });
  });

  it("persists evidence-backed prospects and denies user-authored agent records", async () => {
    const ctx = await setupChannelTest();
    const prospectorId = agentIdSchema.parse("prospector");
    const pubkey = hexKey("workspace-data-prospector");
    await registerTestAgent(ctx, prospectorId, pubkey);
    const prospector = {
      kind: "agent" as const,
      agentId: prospectorId,
      pubkey,
      workspaceId: ctx.workspaceId,
    };
    const input = {
      id: "chief-homepage",
      name: "Chief homepage",
      company: "Chief",
      source: "Company website",
      sourceUrl: "https://heychief.sh/",
      summary: "The public page shows an active product launch.",
      evidence: "The page describes the current product and audience.",
      outreachAngle: "Offer a concrete workflow review.",
      relevance: "high",
      status: "new",
    };

    const denied = await rpc(ctx, ctx.principal, "data-prospect-save", input);
    expect(denied.status).toBe(403);

    const saved = await rpc(ctx, prospector, "data-prospect-save", input);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      id: "chief-homepage",
      authorAgentId: "prospector",
      sourceUrl: "https://heychief.sh/",
    });

    const listed = await rpc(ctx, ctx.principal, "data-prospects-list");
    expect(await listed.json()).toMatchObject({
      prospects: [expect.objectContaining({ id: "chief-homepage" })],
    });
  });

  it("denies specialist data writes outside the agent's granted capability", async () => {
    const ctx = await setupChannelTest();
    const engineerId = agentIdSchema.parse("engineer");
    const pubkey = hexKey("workspace-data-engineer");
    await registerTestAgent(ctx, engineerId, pubkey);
    const engineer = {
      kind: "agent" as const,
      agentId: engineerId,
      pubkey,
      workspaceId: ctx.workspaceId,
    };

    const brand = await rpc(ctx, engineer, "data-brand-save", {
      markdown: "# Not authorized",
      sourceUrls: ["https://heychief.sh/"],
      conversationId: "engineering",
    });
    expect(brand.status).toBe(403);

    const prospect = await rpc(ctx, engineer, "data-prospect-save", {
      id: "not-authorized",
      name: "Not authorized",
      company: "Chief",
      source: "Company website",
      sourceUrl: "https://heychief.sh/",
      summary: "The engineer must not write prospect memory.",
      evidence: "Capability policy denies this write.",
      outreachAngle: "None",
      relevance: "low",
      status: "new",
    });
    expect(prospect.status).toBe(403);
  });
});

function rpc(
  ctx: Awaited<ReturnType<typeof setupChannelTest>>,
  principal: Parameters<typeof withTrustedContext>[1]["principal"],
  operation: string,
  body?: unknown,
) {
  const headers = new Headers({ "x-chief-internal-operation": operation });
  const init: RequestInit = { method: "POST", headers };
  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }
  const request = withTrustedContext(
    new Request("https://workspace.internal", init),
    {
      principal,
      requestId: crypto.randomUUID(),
      workspaceId: ctx.workspaceId,
    },
  );
  const workspaces = (
    ctx.env as unknown as { WORKSPACES: DurableObjectNamespace }
  ).WORKSPACES;
  return workspaces.get(workspaces.idFromName(ctx.workspaceId)).fetch(request);
}
