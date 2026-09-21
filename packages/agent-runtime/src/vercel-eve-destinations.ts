import type { Attributes } from "@opentelemetry/api";
import { z } from "zod";

import type { VercelEveDestinationCatalog } from "./types.js";
import {
  recordEveDeploymentEvent,
  withEveDeploymentSpan,
} from "./eve-deployment-telemetry.js";
import {
  parseJsonBody,
  projectsSchema,
  requestJson,
  teamsSchema,
  vercelUrl,
} from "./vercel-eve-api.js";
import {
  availableVercelProjectName,
  isReservedVercelProjectName,
} from "./vercel-project-names.js";

interface DestinationListOptions {
  token: string;
  teamId?: string;
  fetcher?: typeof fetch;
}

export async function listVercelEveDestinations(
  options: DestinationListOptions,
): Promise<VercelEveDestinationCatalog> {
  const attributes: Attributes = {};
  if (options.teamId) attributes["vercel.team.id"] = options.teamId;
  return await withEveDeploymentSpan(
    "chief.eve.destination.list",
    attributes,
    async (span) => {
      recordEveDeploymentEvent(span, "destination_list_started");
      const catalog = await listVercelEveDestinationsInternal(options);
      recordEveDeploymentEvent(span, "destination_list_completed", {
        "vercel.team.count": catalog.teams.length,
        "vercel.project.count": catalog.projects.length,
      });
      return catalog;
    },
  );
}

async function listVercelEveDestinationsInternal({
  token,
  teamId,
  fetcher = fetch,
}: DestinationListOptions): Promise<VercelEveDestinationCatalog> {
  const { teams } = await requestJson({
    fetcher,
    token,
    url: vercelUrl("/v2/teams", { limit: "100" }),
    schema: teamsSchema,
    errorMessage:
      "Vercel rejected this access token. Create a new token and try again.",
  });
  if (!teamId) return { teams, projects: [] };
  if (!teams.some((team) => team.id === teamId)) {
    throw new Error("Choose a Vercel team available to this connection.");
  }
  const response = await requestJson({
    fetcher,
    token,
    url: vercelUrl("/v9/projects", { limit: "100", teamId }),
    schema: projectsSchema,
  });
  return {
    teams,
    selectedTeamId: teamId,
    projects: response.projects.map((project) => {
      const production = project.latestDeployments?.find(
        (deployment) => deployment.target === "production" && deployment.url,
      );
      const option = {
        id: project.id,
        name: project.name,
      };
      if (project.framework)
        Object.assign(option, { framework: project.framework });
      if (production?.url) {
        Object.assign(option, {
          productionDeploymentUrl: `https://${production.url}`,
        });
      }
      return option;
    }),
  };
}

async function findExistingVercelProject({
  fetcher,
  name,
  teamId,
  token,
}: {
  fetcher: typeof fetch;
  name: string;
  teamId: string;
  token: string;
}) {
  const url = vercelUrl(`/v9/projects/${encodeURIComponent(name)}`, { teamId });
  const response = await fetcher(url, {
    headers: { authorization: `Bearer ${token}` },
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("Vercel did not respond within 20 seconds.");
    }
    throw error;
  });
  if (response.status === 404) return null;
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Vercel returned ${response.status}.`);
  }
  const parsed = z
    .object({ id: z.string().min(1), name: z.string().min(1) })
    .passthrough()
    .safeParse(
      parseJsonBody(text, "Vercel returned a web page instead of JSON."),
    );
  return parsed.success ? parsed.data : null;
}

export async function resolveUnusedProjectName({
  fetcher,
  preferredName,
  teamId,
  token,
}: {
  fetcher: typeof fetch;
  preferredName: string;
  teamId: string;
  token: string;
}) {
  const taken: string[] = [];
  let preferred = preferredName;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = availableVercelProjectName(preferred, taken);
    assertProjectNameAllowed(candidate);
    const existing = await findExistingVercelProject({
      fetcher,
      name: candidate,
      teamId,
      token,
    });
    if (!existing) return candidate;
    taken.push(existing.name);
    preferred = candidate;
  }
  throw new Error("Chief could not find an unused Vercel project name.");
}

export function assertProjectNameAllowed(name: string) {
  if (!isReservedVercelProjectName(name)) return;
  throw new Error(
    `"${name}" is reserved for Chief's own Vercel project. Deploy this Eve agent under a different name.`,
  );
}
