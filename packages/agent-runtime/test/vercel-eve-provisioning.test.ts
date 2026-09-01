import assert from "node:assert/strict";
import test from "node:test";

import {
  listVercelEveDestinations,
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

void test("lists destinations only for an explicitly selected Vercel team", async () => {
  const requested: URL[] = [];
  const fetcher: typeof fetch = async (request) => {
    await Promise.resolve();
    const url = new URL(new Request(request).url);
    requested.push(url);
    if (url.pathname === "/v2/teams") {
      return Response.json({
        teams: [{ id: "team_chief", name: "Chief", slug: "chief" }],
      });
    }
    return Response.json({
      projects: [
        {
          id: "prj_researcher",
          name: "researcher",
          framework: "eve",
          latestDeployments: [
            {
              target: "production",
              url: "researcher.vercel.app",
            },
          ],
        },
      ],
    });
  };

  const teams = await listVercelEveDestinations({
    token: "vercel-token",
    fetcher,
  });
  assert.deepEqual(teams.projects, []);
  assert.equal(requested.length, 1);

  const selected = await listVercelEveDestinations({
    token: "vercel-token",
    teamId: "team_chief",
    fetcher,
  });
  assert.equal(selected.selectedTeamId, "team_chief");
  assert.equal(selected.projects[0]?.id, "prj_researcher");
  assert.equal(requested[2]?.searchParams.get("teamId"), "team_chief");
});

void test("uploads, deploys, configures, and checks an Eve agent in the selected project", async () => {
  const requests: { method: string; url: URL; body: string | null }[] = [];
  const phases: string[] = [];
  const fetcher: typeof fetch = async (request, init) => {
    const url = new URL(new Request(request).url);
    const method = init?.method ?? "GET";
    requests.push({
      method,
      url,
      body: init?.body ? await new Response(init.body).text() : null,
    });
    if (url.hostname === "researcher-build.vercel.app") {
      return Response.json({ status: "ready" });
    }
    if (url.pathname === "/v2/teams") {
      return Response.json({
        teams: [{ id: "team_chief", name: "Chief", slug: "chief" }],
      });
    }
    if (url.pathname === "/v9/projects") {
      return Response.json({
        projects: [
          {
            id: "prj_researcher",
            name: "researcher",
            framework: "eve",
          },
        ],
      });
    }
    if (url.pathname === "/v2/files") return Response.json({});
    if (method === "POST" && url.pathname === "/v13/deployments") {
      return Response.json({
        id: "dpl_researcher",
        projectId: "prj_researcher",
        readyState: "QUEUED",
        url: "researcher-build.vercel.app",
      });
    }
    if (method === "POST" && url.pathname.endsWith("/env")) {
      return Response.json({ created: [] });
    }
    return Response.json({
      id: "dpl_researcher",
      projectId: "prj_researcher",
      readyState: "READY",
      url: "researcher-build.vercel.app",
    });
  };

  const result = await provisionVercelEveDeployment({
    token: "vercel-token",
    fetcher,
    pollIntervalMs: 0,
    onProgress: (progress) => phases.push(progress.phase),
    input: {
      teamId: "team_chief",
      project: {
        kind: "existing",
        projectId: "prj_researcher",
        projectName: "researcher",
      },
      agent: {
        name: "Researcher",
        description: "Researches questions.",
        instructions: "# Identity\n\nResearch carefully.",
        model: "openai/gpt-5.6-terra",
      },
      environment,
    },
  });

  assert.equal(result.deploymentId, "dpl_researcher");
  assert.equal(result.deploymentUrl, "https://researcher-build.vercel.app");
  assert.equal(
    requests.filter((request) => request.url.pathname === "/v2/files").length,
    4,
  );
  const uploadedSources = requests
    .filter((request) => request.url.pathname === "/v2/files")
    .map((request) => request.body ?? "")
    .join("\n");
  assert.match(uploadedSources, /"reasoning\.appended"/u);
  assert.match(uploadedSources, /"reasoning\.completed"/u);
  assert.match(uploadedSources, /"actions\.requested"/u);
  assert.match(uploadedSources, /channel\/\$\{path\}/u);
  assert.match(uploadedSources, /postToChief\("activity"/u);
  assert.match(uploadedSources, /authorization/u);
  assert.match(uploadedSources, /timingSafeEqual/u);
  assert.doesNotMatch(
    uploadedSources,
    /x-chief-external-channel-authorization/u,
  );
  const deployment = requests.find(
    (request) =>
      request.method === "POST" && request.url.pathname === "/v13/deployments",
  );
  assert.ok(deployment);
  assert.equal(deployment.url.searchParams.get("teamId"), "team_chief");
  assert.match(deployment.body ?? "", /prj_researcher/);
  const environmentRequest = requests.find((request) =>
    request.url.pathname.endsWith("/env"),
  );
  assert.match(environmentRequest?.body ?? "", /"type":"sensitive"/);
  assert.deepEqual(phases, [
    "validating",
    "uploading",
    "deploying",
    "configuring",
    "waiting",
    "checking",
  ]);
});

void test("rejects a project that does not belong to the selected team", async () => {
  await assert.rejects(
    provisionVercelEveDeployment({
      token: "vercel-token",
      fetcher: async (request) => {
        await Promise.resolve();
        const url = new URL(new Request(request).url);
        return url.pathname === "/v2/teams"
          ? Response.json({
              teams: [{ id: "team_chief", name: "Chief", slug: "chief" }],
            })
          : Response.json({ projects: [] });
      },
      input: {
        teamId: "team_chief",
        project: {
          kind: "existing",
          projectId: "prj_other",
          projectName: "other",
        },
        agent: {
          name: "Researcher",
          description: "Researches questions.",
          instructions: "Research carefully.",
          model: "openai/gpt-5.6-terra",
        },
        environment,
      },
    }),
    /Choose a Vercel project from the selected team/,
  );
});

void test("deletes a newly created Vercel project when its Chief channel fails", async () => {
  let deletedProject = "";
  const fetcher: typeof fetch = async (request, init) => {
    await Promise.resolve();
    const url = new URL(new Request(request).url);
    const method = init?.method ?? "GET";
    if (url.hostname === "broken-eve.vercel.app") {
      return new Response("Not ready", { status: 500 });
    }
    if (url.pathname === "/v2/teams") {
      return Response.json({
        teams: [{ id: "team_chief", name: "Chief", slug: "chief" }],
      });
    }
    if (url.pathname === "/v9/projects") {
      return Response.json({ projects: [] });
    }
    if (url.pathname === "/v2/files") return Response.json({});
    if (method === "POST" && url.pathname === "/v13/deployments") {
      return Response.json({
        id: "dpl_broken",
        projectId: "prj_broken",
        readyState: "QUEUED",
        url: "broken-eve.vercel.app",
      });
    }
    if (method === "POST" && url.pathname.endsWith("/env")) {
      return Response.json({ created: [] });
    }
    if (method === "DELETE") {
      deletedProject = url.pathname;
      return Response.json({});
    }
    return Response.json({
      id: "dpl_broken",
      projectId: "prj_broken",
      readyState: "READY",
      url: "broken-eve.vercel.app",
    });
  };

  await assert.rejects(
    provisionVercelEveDeployment({
      token: "vercel-token",
      fetcher,
      pollIntervalMs: 0,
      input: {
        teamId: "team_chief",
        project: { kind: "new", projectName: "broken-eve" },
        agent: {
          name: "Researcher",
          description: "Researches questions.",
          instructions: "Research carefully.",
          model: "openai/gpt-5.6-terra",
        },
        environment,
      },
    }),
    /Chief channel returned HTTP 500/,
  );
  assert.equal(deletedProject, "/v9/projects/prj_broken");
});
