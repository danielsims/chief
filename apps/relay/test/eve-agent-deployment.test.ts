import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceObject } from "../src/workspace-object";
import { setupChannelTest } from "./channel-test-helpers";
import {
  registerExternalAgent,
  workspaceFetch,
} from "./external-agent-channel-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Eve agent deployments", () => {
  it("routes to the production domain and redeploys from the saved settings", async () => {
    const ctx = await setupChannelTest();
    const registration = await registerExternalAgent(ctx, {
      agentId: "eve-chief",
      endpoint: "https://chief-program-old.vercel.app/channels/chief/messages",
    });
    const deployments: string[] = [];
    vi.stubGlobal("fetch", vercelFetch(deployments));
    const connected = await workspaceFetch(
      ctx,
      "vercel-connect",
      { token: "vercel-token" },
      ctx.principal,
      "https://workspace.internal",
    );
    expect(connected.status).toBe(200);

    const provisioned = await workspaceFetch(
      ctx,
      "vercel-provision",
      {
        teamId: "team_chief",
        project: {
          kind: "existing",
          projectId: "prj_chief",
          projectName: "chief-program",
        },
        agent: {
          id: "eve-chief",
          name: "Chief",
          description: "Leads the workspace.",
          instructions: "Lead the workspace.",
          model: "deepseek/deepseek-v4-flash",
        },
        environment: {
          CHIEF_AGENT_ID: "eve-chief",
          CHIEF_CHANNEL_TOKEN: registration.channel.token,
          CHIEF_DELIVERY_SIGNING_KEY_ID:
            registration.channel.deliverySigningKeyId,
          CHIEF_DELIVERY_SIGNING_SECRET:
            registration.channel.deliverySigningSecret,
          CHIEF_RELAY_URL: "https://relay.test",
          CHIEF_WORKSPACE_ID: ctx.workspaceId,
        },
      },
      ctx.principal,
      "https://workspace.internal",
    );
    expect(await provisioned.text()).toContain('"kind":"complete"');
    expect(await endpoint(ctx)).toBe(
      "https://chief-program.vercel.app/channels/chief/messages",
    );

    const redeployed = await workspaceFetch(
      ctx,
      "vercel-redeploy",
      { agentId: "eve-chief" },
      ctx.principal,
      "https://workspace.internal",
    );
    expect(await redeployed.text()).toContain('"kind":"complete"');
    expect(deployments).toEqual(["prj_chief", "prj_chief"]);
  });
});

async function endpoint(ctx: Awaited<ReturnType<typeof setupChannelTest>>) {
  const stub = ctx.env.WORKSPACES.get(
    ctx.env.WORKSPACES.idFromName(ctx.workspaceId),
  );
  return runInDurableObject(
    stub,
    (_instance: WorkspaceObject, state) =>
      state.storage.sql
        .exec<{ endpoint_url: string }>(
          "SELECT endpoint_url FROM external_agent_runtimes WHERE agent_id = 'eve-chief'",
        )
        .one().endpoint_url,
  );
}

function vercelFetch(deployments: string[]): typeof fetch {
  const project = {
    id: "prj_chief",
    name: "chief-program",
    accountId: "team_chief",
  };
  const deployment = {
    id: "dpl_chief",
    projectId: "prj_chief",
    readyState: "READY",
    url: "chief-program-abc.vercel.app",
    alias: ["chief-program.vercel.app"],
  };
  return async (request, init) => {
    const url = new URL(new Request(request).url);
    const method = init?.method ?? "GET";
    if (url.pathname === "/v2/teams") {
      return Response.json({
        teams: [{ id: "team_chief", name: "Chief", slug: "chief" }],
      });
    }
    if (url.pathname === "/v1/api-keys") {
      return Response.json({ apiKeyString: "gateway-key" });
    }
    if (url.pathname === "/v9/projects") {
      return Response.json({ projects: [project] });
    }
    if (url.pathname.endsWith("/env")) {
      if (method === "POST") return Response.json({ created: [] });
      return Response.json({
        envs: [
          "CHIEF_AGENT_ID",
          "CHIEF_CHANNEL_TOKEN",
          "CHIEF_DELIVERY_SIGNING_KEY_ID",
          "CHIEF_DELIVERY_SIGNING_SECRET",
          "CHIEF_RELAY_URL",
          "CHIEF_WORKSPACE_ID",
          "AI_GATEWAY_API_KEY",
        ].map((key) => ({ key })),
      });
    }
    if (url.pathname.endsWith("/events")) return Response.json([]);
    if (method === "POST" && url.pathname === "/v13/deployments") {
      const body = (await new Request(request, init).json()) as {
        project?: string;
      };
      deployments.push(body.project ?? "");
      return Response.json({ ...deployment, readyState: "QUEUED" });
    }
    if (url.pathname.startsWith("/v13/deployments/")) {
      return Response.json(deployment);
    }
    if (/\/projects\/[^/]+$/u.test(url.pathname)) {
      return Response.json(project);
    }
    return Response.json({});
  };
}
