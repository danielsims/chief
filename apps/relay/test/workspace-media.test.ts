import { describe, expect, it } from "vitest";

import {
  agentPrincipalSchema,
  workspaceFilesResultSchema,
  workspaceIdSchema,
} from "@chief/relay-contracts";

import { getAgentArtifact } from "../src/agent-artifacts";
import { withTrustedContext } from "../src/internal-context";
import {
  parseWorkspaceMediaUpload,
  saveWorkspaceMedia,
} from "../src/workspace-media";
import {
  channelEnvelope,
  channelRpc,
  registerTestAgent,
  setupChannelTest,
} from "./channel-test-helpers";
import { hexKey } from "./helpers";

describe("workspace media", () => {
  it("persists uploaded bytes with their file record and protects them from text edits and other workspace scopes", async () => {
    const ctx = await setupChannelTest();
    const pubkey = hexKey("workspace-media-engineer");
    await registerTestAgent(ctx, "engineer", pubkey);
    const principal = agentPrincipalSchema.parse({
      kind: "agent",
      agentId: "engineer",
      pubkey,
      workspaceId: ctx.workspaceId,
      role: "member",
    });
    await channelRpc(
      ctx,
      ctx.principal,
      "channels-create",
      channelEnvelope({
        conversationId: "private-output",
        name: "private-output",
        isPrivate: true,
      }),
    );
    await channelRpc(
      ctx,
      ctx.principal,
      "channels-members-add",
      channelEnvelope({
        conversationId: "private-output",
        kind: "agent",
        principalId: "engineer",
      }),
    );
    const source = new Uint8Array([137, 80, 78, 71, 0, 255, 13, 10]);
    const input = await parseWorkspaceMediaUpload(
      new Request("https://relay.test/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "campaign.png",
          contentType: "image/png",
          conversationId: "private-output",
          contentBase64: btoa(String.fromCharCode(...source)),
        }),
      }),
    );
    const file = await saveWorkspaceMedia(ctx.env, principal, input);
    expect(file.asset).toEqual({
      artifactId: file.id,
      agentId: "engineer",
      bytes: source.byteLength,
    });
    const listing = workspaceFilesResultSchema.parse(
      await (await channelRpc(ctx, ctx.principal, "data-files-list")).json(),
    );
    expect(listing.files.find((candidate) => candidate.id === file.id)).toEqual(
      file,
    );
    const outsiderKey = hexKey("workspace-media-outsider");
    await registerTestAgent(ctx, "coordinator", outsiderKey);
    const outsider = agentPrincipalSchema.parse({
      kind: "agent",
      agentId: "coordinator",
      pubkey: outsiderKey,
      workspaceId: ctx.workspaceId,
      role: "member",
    });
    const hidden = workspaceFilesResultSchema.parse(
      await (await channelRpc(ctx, outsider, "data-files-list")).json(),
    );
    expect(hidden.files.some((candidate) => candidate.id === file.id)).toBe(
      false,
    );
    expect(
      (
        await getAgentArtifact(
          ctx.env,
          outsider,
          ctx.workspaceId,
          "engineer",
          file.id,
        )
      ).status,
    ).toBe(404);
    const response = await getAgentArtifact(
      ctx.env,
      ctx.principal,
      ctx.workspaceId,
      "engineer",
      file.id,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(source);
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const otherScope = await getAgentArtifact(
      ctx.env,
      ctx.principal,
      workspaceIdSchema.parse("another-workspace"),
      "engineer",
      file.id,
    );
    expect(otherScope.status).toBe(404);
    const update = await ctx.env.WORKSPACES.get(
      ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
    ).fetch(
      withTrustedContext(
        new Request("https://workspace.internal", {
          method: "POST",
          headers: {
            "x-chief-internal-operation": "data-file-update",
            "x-chief-workspace-file-id": file.id,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            title: "corrupted",
            content: "replacement text",
            expectedVersion: file.version,
          }),
        }),
        {
          principal: ctx.principal,
          workspaceId: ctx.workspaceId,
          requestId: crypto.randomUUID(),
        },
      ),
    );
    expect(update.status).toBe(409);
    expect(
      new Uint8Array(
        await (
          await getAgentArtifact(
            ctx.env,
            ctx.principal,
            ctx.workspaceId,
            "engineer",
            file.id,
          )
        ).arrayBuffer(),
      ),
    ).toEqual(source);
  });
});
