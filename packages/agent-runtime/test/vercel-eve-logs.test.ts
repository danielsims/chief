import assert from "node:assert/strict";
import test from "node:test";

import {
  parseDeploymentEvents,
  provisionVercelEveDeployment,
} from "../src/vercel-eve-provisioning.js";

const environment = {
  CHIEF_AGENT_ID: "researcher",
  CHIEF_CHANNEL_TOKEN: "channel-token",
  CHIEF_DELIVERY_SIGNING_KEY_ID: "dsk_researcher",
  CHIEF_DELIVERY_SIGNING_SECRET: "signing-secret",
  CHIEF_RELAY_URL: "https://relay.example.com",
  CHIEF_WORKSPACE_ID: "workspace-1",
};

void test("parses Vercel deployment events from JSON arrays and NDJSON", () => {
  assert.deepEqual(
    parseDeploymentEvents(
      `${JSON.stringify({ payload: { text: "Build failed: missing output" } })}\n`,
    ),
    [{ payload: { text: "Build failed: missing output" } }],
  );
  assert.equal(
    parseDeploymentEvents(
      JSON.stringify([
        { type: "command", payload: { text: "Running build" } },
        { type: "stderr", payload: { text: "Error: eve build failed" } },
      ]),
    )[1]?.payload?.text,
    "Error: eve build failed",
  );
});

void test("surfaces the Vercel build log when a deployment errors", async () => {
  const fetcher: typeof fetch = async (request, init) => {
    await Promise.resolve();
    const url = new URL(new Request(request).url);
    const method = init?.method ?? "GET";
    if (url.pathname === "/v2/teams") {
      return Response.json({
        teams: [{ id: "team_chief", name: "Chief", slug: "chief" }],
      });
    }
    if (url.pathname === "/v9/projects") {
      return Response.json({ projects: [] });
    }
    if (url.pathname.startsWith("/v9/projects/") && method === "GET") {
      return new Response("Not found", { status: 404 });
    }
    if (method === "POST" && url.pathname === "/v11/projects") {
      return Response.json({
        id: "prj_failed",
        name: "failed-eve",
        accountId: "team_chief",
      });
    }
    if (method === "POST" && url.pathname === "/v13/deployments") {
      return Response.json({
        id: "dpl_failed",
        projectId: "prj_failed",
        readyState: "QUEUED",
        url: "failed-eve.vercel.app",
      });
    }
    if (method === "POST" && url.pathname.endsWith("/env")) {
      return Response.json({ created: [] });
    }
    if (url.pathname.endsWith("/events")) {
      return new Response(
        `${JSON.stringify({ payload: { text: "Error: .output directory was not found" } })}\n`,
        { headers: { "content-type": "application/x-ndjson" } },
      );
    }
    return Response.json({
      id: "dpl_failed",
      projectId: "prj_failed",
      readyState: "ERROR",
      url: "failed-eve.vercel.app",
    });
  };

  await assert.rejects(
    provisionVercelEveDeployment({
      token: "vercel-token",
      fetcher,
      pollIntervalMs: 0,
      input: {
        teamId: "team_chief",
        project: { kind: "new", projectName: "failed-eve" },
        agent: {
          name: "Researcher",
          description: "Researches questions.",
          instructions: "Research carefully.",
          model: "openai/gpt-5.6-terra",
        },
        environment,
      },
    }),
    /\.output directory was not found/u,
  );
});
