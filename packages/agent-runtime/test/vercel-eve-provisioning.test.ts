import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import {
  listVercelEveDestinations,
  provisionVercelEveDeployment,
} from "../src/vercel-eve-provisioning.js";

const deployedFilesSchema = z.object({
  files: z
    .array(z.object({ data: z.string().optional() }).passthrough())
    .optional(),
});

const environment = {
  CHIEF_AGENT_ID: "researcher",
  CHIEF_CHANNEL_TOKEN: "channel-token",
  CHIEF_DELIVERY_SIGNING_KEY_ID: "dsk_researcher",
  CHIEF_DELIVERY_SIGNING_SECRET: "signing-secret",
  CHIEF_RELAY_URL: "https://relay.example.com",
  CHIEF_WORKSPACE_ID: "workspace-1",
};

function deployedFileContents(body: string | null) {
  const parsed = deployedFilesSchema.safeParse(JSON.parse(body ?? "{}"));
  if (!parsed.success) return "";
  return (parsed.data.files ?? [])
    .map((file) =>
      file.data ? Buffer.from(file.data, "base64").toString("utf8") : "",
    )
    .join("\n");
}

function deploymentBody(
  requests: { method: string; url: URL; body: string | null }[],
) {
  return (
    requests.find(
      (request) =>
        request.method === "POST" &&
        request.url.pathname === "/v13/deployments",
    )?.body ?? null
  );
}

function vercelProjectNameFromPath(pathname: string) {
  return pathname.startsWith("/v9/projects/") && pathname !== "/v9/projects"
    ? decodeURIComponent(pathname.slice("/v9/projects/".length))
    : null;
}

function newEveProjectFetcher({
  existingProjects = {},
  listedProjects,
  onDeploy,
  readyState = "READY",
  eventText = "Running eve build",
}: {
  existingProjects?: Record<string, { id: string; name: string }>;
  listedProjects?: { id: string; name: string }[];
  onDeploy?: (body: string | null) => void;
  readyState?: string;
  eventText?: string;
}): typeof fetch {
  return async (request, init) => {
    const url = new URL(new Request(request).url);
    const method = init?.method ?? "GET";
    const body = init?.body ? await new Response(init.body).text() : null;
    if (url.pathname === "/v2/teams") {
      return Response.json({
        teams: [{ id: "team_chief", name: "Chief", slug: "chief" }],
      });
    }
    if (url.pathname === "/v9/projects") {
      return Response.json({
        projects: listedProjects ?? Object.values(existingProjects),
      });
    }
    if (method === "POST" && url.pathname === "/v11/projects") {
      const created = z
        .object({ name: z.string() })
        .parse(JSON.parse(body ?? "{}"));
      return Response.json({
        id: "prj_new",
        name: created.name,
        accountId: "team_chief",
      });
    }
    const projectName = vercelProjectNameFromPath(url.pathname);
    if (method === "GET" && projectName) {
      const existing = existingProjects[projectName];
      return existing
        ? Response.json(existing)
        : new Response("Not found", { status: 404 });
    }
    if (method === "POST" && url.pathname === "/v13/deployments") {
      onDeploy?.(body);
      return Response.json({
        id: "dpl_eve",
        projectId: "prj_new",
        readyState: "QUEUED",
        url: "agent-build.vercel.app",
      });
    }
    if (url.pathname.endsWith("/events")) {
      return Response.json([{ payload: { text: eventText } }]);
    }
    if (url.pathname.endsWith("/env")) {
      if (method === "POST") return Response.json({ created: [] });
      return Response.json({
        envs: Object.keys(environment).map((key) => ({ key })),
      });
    }
    return Response.json({
      id: "dpl_eve",
      projectId: "prj_new",
      readyState,
      url: "agent-build.vercel.app",
    });
  };
}

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
      throw new Error(`Unexpected request to the Eve site ${url.href}`);
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
    if (method === "GET" && url.pathname === "/v9/projects/prj_researcher") {
      return Response.json({
        id: "prj_researcher",
        name: "researcher",
        accountId: "team_chief",
      });
    }
    if (method === "POST" && url.pathname === "/v13/deployments") {
      return Response.json({
        id: "dpl_researcher",
        projectId: "prj_researcher",
        readyState: "QUEUED",
        url: "researcher-build.vercel.app",
      });
    }
    if (url.pathname.endsWith("/events")) {
      return Response.json([
        {
          type: "stdout",
          created: 1_700_000_000_000,
          payload: { text: "Running eve build" },
        },
      ]);
    }
    if (url.pathname.endsWith("/env")) {
      if (method === "POST") return Response.json({ created: [] });
      return Response.json({
        envs: Object.keys(environment).map((key) => ({ key })),
      });
    }
    return Response.json({
      id: "dpl_researcher",
      projectId: "prj_researcher",
      readyState: "READY",
      url: "researcher-build.vercel.app",
    });
  };

  const logs: string[] = [];
  const result = await provisionVercelEveDeployment({
    token: "vercel-token",
    fetcher,
    pollIntervalMs: 0,
    onProgress: (progress) => {
      phases.push(progress.phase);
      for (const line of progress.logs ?? []) logs.push(line.text);
    },
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
    0,
  );
  const uploadedSources = deployedFileContents(deploymentBody(requests));
  assert.match(uploadedSources, /"reasoning\.appended"/u);
  assert.match(uploadedSources, /"reasoning\.completed"/u);
  assert.match(uploadedSources, /"actions\.requested"/u);
  assert.match(uploadedSources, /channel\/\$\{path\}/u);
  assert.match(uploadedSources, /postToChief\("activity"/u);
  assert.match(uploadedSources, /"turn\.completed"/u);
  assert.match(uploadedSources, /postReply/u);
  assert.match(uploadedSources, /\[chief-message\] publish failed/u);
  assert.match(uploadedSources, /authorization/u);
  assert.match(uploadedSources, /timingSafeEqual/u);
  assert.match(uploadedSources, /"eve": "0\.52\.2"/u);
  assert.match(uploadedSources, /"node": "24\.x"/u);
  assert.match(uploadedSources, /"typecheck": "tsc"/u);
  assert.match(uploadedSources, /eve\/workflow-modules/u);
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
  assert.match(deployment.body ?? "", /"framework":"eve"/u);
  assert.match(deployment.body ?? "", /"gitMetadata"/u);
  assert.match(deployment.body ?? "", /\/git\/workspace-1\/researcher\.git/u);
  assert.doesNotMatch(deployment.body ?? "", /"outputDirectory"/u);
  const environmentRequest = requests.find((request) =>
    request.url.pathname.endsWith("/env"),
  );
  assert.match(environmentRequest?.body ?? "", /"type":"sensitive"/);
  assert.equal(
    requests.some(
      (request) =>
        request.method === "PATCH" &&
        request.url.pathname === "/v9/projects/prj_researcher" &&
        (request.body ?? "").includes('"ssoProtection":null'),
    ),
    true,
  );
  assert.equal(
    requests.some((request) => request.url.hostname.endsWith(".vercel.app")),
    false,
  );
  assert.ok(
    requests.filter((request) => request.url.pathname.endsWith("/events"))
      .length <= 2,
  );
  assert.equal(logs.includes("Running eve build"), true);
  assert.equal(phases[0], "validating");
  assert.ok(phases.includes("waiting"));
  assert.equal(phases.at(-1), "checking");
});

void test("creates the next numbered Vercel project when the preferred name is taken", async () => {
  const requests: string[] = [];
  const logs: string[] = [];
  let deployedBody = "";
  const fetcher = newEveProjectFetcher({
    existingProjects: {
      "program-eve": { id: "prj_program", name: "program-eve" },
    },
    onDeploy: (body) => {
      deployedBody = body ?? "";
    },
  });
  const result = await provisionVercelEveDeployment({
    token: "vercel-token",
    fetcher: async (request, init) => {
      const url = new URL(new Request(request).url);
      requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
      return await fetcher(request, init);
    },
    pollIntervalMs: 0,
    onProgress: (progress) => {
      for (const line of progress.logs ?? []) logs.push(line.text);
    },
    input: {
      teamId: "team_chief",
      project: { kind: "new", projectName: "program-eve" },
      agent: {
        name: "Chief",
        description: "Coordinates the workspace.",
        instructions: "Coordinate the workspace.",
        model: "openai/gpt-5.6-terra",
      },
      environment,
    },
  });
  assert.equal(result.deploymentId, "dpl_eve");
  assert.match(deployedBody, /"name":"program-eve-2"/u);
  assert.equal(
    logs.some((line) =>
      line.includes('"program-eve" is taken. Using program-eve-2.'),
    ),
    true,
  );
  assert.equal(
    requests.some((request) => request.startsWith("DELETE ")),
    false,
  );
});

void test("does not treat a stale project list as proof a deleted name is taken", async () => {
  let deployedBody = "";
  const logs: string[] = [];
  await provisionVercelEveDeployment({
    token: "vercel-token",
    fetcher: newEveProjectFetcher({
      existingProjects: {},
      listedProjects: [{ id: "prj_gone", name: "program-chief" }],
      onDeploy: (body) => {
        deployedBody = body ?? "";
      },
    }),
    pollIntervalMs: 0,
    onProgress: (progress) => {
      for (const line of progress.logs ?? []) logs.push(line.text);
    },
    input: {
      teamId: "team_chief",
      project: { kind: "new", projectName: "program-chief" },
      agent: {
        name: "Chief",
        description: "Coordinates the workspace.",
        instructions: "Coordinate the workspace.",
        model: "openai/gpt-5.6-terra",
      },
      environment,
    },
  });
  assert.match(deployedBody, /"name":"program-chief"/u);
  assert.equal(
    logs.some((line) => line.includes("is taken")),
    false,
  );
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

void test("refuses to deploy Eve onto Chief's own Vercel project", async () => {
  await assert.rejects(
    provisionVercelEveDeployment({
      token: "vercel-token",
      fetcher: () =>
        Promise.reject(
          new Error("Vercel should not be contacted for a reserved project."),
        ),
      input: {
        teamId: "team_chief",
        project: {
          kind: "existing",
          projectId: "prj_web",
          projectName: "chief-web",
        },
        agent: {
          name: "Chief",
          description: "Coordinates the workspace.",
          instructions: "Coordinate the workspace.",
          model: "openai/gpt-5.6-terra",
        },
        environment,
      },
    }),
    /reserved for Chief's own Vercel project/u,
  );
});

void test("explains HTML responses from Vercel instead of treating them as JSON", async () => {
  await assert.rejects(
    provisionVercelEveDeployment({
      token: "vercel-token",
      fetcher: async (request) => {
        await Promise.resolve();
        const url = new URL(new Request(request).url);
        if (url.pathname === "/v2/teams") {
          return new Response(
            "<!DOCTYPE html><html><body>Login</body></html>",
            {
              status: 401,
              headers: { "content-type": "text/html" },
            },
          );
        }
        return Response.json({});
      },
      input: {
        teamId: "team_chief",
        project: { kind: "new", projectName: "html-eve" },
        agent: {
          name: "Researcher",
          description: "Researches questions.",
          instructions: "Research carefully.",
          model: "openai/gpt-5.6-terra",
        },
        environment,
      },
    }),
    /web page/u,
  );
});

const securityInput = {
  teamId: "team_chief",
  project: { kind: "new" as const, projectName: "isolated-eve" },
  agent: {
    name: "Chief",
    description: "Coordinator",
    instructions: "Coordinate.",
    model: "openai/gpt-5.6-terra",
  },
  environment,
};

for (const mismatch of [
  "creation-collision",
  "creation-team",
  "deployment-project",
  "poll-project",
  "poll-id",
]) {
  void test(`stops provisioning on ${mismatch} without touching another project`, async () => {
    const requests: { url: URL; method: string; body: string | null }[] = [];
    const base = newEveProjectFetcher({});
    const fetcher: typeof fetch = async (request, init) => {
      const url = new URL(new Request(request).url);
      const method = init?.method ?? "GET";
      const body = init?.body ? await new Response(init.body).text() : null;
      requests.push({ url, method, body });
      assert.equal(
        init?.redirect,
        "error",
        "All credential-bearing requests reject redirects",
      );
      if (url.pathname === "/v11/projects") {
        assert.ok(!body?.includes(environment.CHIEF_CHANNEL_TOKEN));
        if (mismatch === "creation-collision")
          return Response.json(
            { error: { message: "Project already exists" } },
            { status: 409 },
          );
        if (mismatch === "creation-team")
          return Response.json({
            id: "prj_other",
            name: "isolated-eve",
            accountId: "team_other",
          });
      }
      if (
        mismatch === "deployment-project" &&
        url.pathname === "/v13/deployments"
      ) {
        return Response.json({
          id: "dpl_eve",
          projectId: "prj_other",
          readyState: "QUEUED",
        });
      }
      if (
        mismatch.startsWith("poll-") &&
        url.pathname === "/v13/deployments/dpl_eve"
      ) {
        return Response.json({
          id: mismatch === "poll-id" ? "dpl_other" : "dpl_eve",
          projectId: mismatch === "poll-project" ? "prj_other" : "prj_new",
          readyState: "READY",
        });
      }
      return base(request, init);
    };
    await assert.rejects(
      provisionVercelEveDeployment({
        token: "test-token",
        input: securityInput,
        fetcher,
        pollIntervalMs: 0,
      }),
    );
    assert.ok(requests.every((r) => !r.url.pathname.includes("prj_other")));
    if (mismatch.startsWith("creation-")) {
      assert.ok(!requests.some((r) => r.url.pathname === "/v13/deployments"));
    }
    if (mismatch === "deployment-project") {
      assert.ok(
        !requests.some(
          (r) => r.url.pathname.endsWith("/env") || r.method === "PATCH",
        ),
      );
    }
    const deployment = requests.find(
      (r) => r.url.pathname === "/v13/deployments",
    );
    if (deployment) assert.match(deployment.body ?? "", /"project":"prj_new"/u);
  });
}

void test("rejects an existing project's changed identity before uploading or mutating", async () => {
  const base = newEveProjectFetcher({
    listedProjects: [{ id: "prj_selected", name: "isolated-eve" }],
  });
  const writes: string[] = [];
  await assert.rejects(
    provisionVercelEveDeployment({
      token: "test-token",
      input: {
        ...securityInput,
        project: {
          kind: "existing",
          projectId: "prj_selected",
          projectName: "isolated-eve",
        },
      },
      fetcher: async (request, init) => {
        const url = new URL(new Request(request).url);
        if ((init?.method ?? "GET") !== "GET") writes.push(url.pathname);
        if (url.pathname === "/v9/projects/prj_selected") {
          return Response.json({
            id: "prj_other",
            name: "isolated-eve",
            accountId: "team_chief",
          });
        }
        return base(request, init);
      },
    }),
    /different project/u,
  );
  assert.deepEqual(writes, []);
});
