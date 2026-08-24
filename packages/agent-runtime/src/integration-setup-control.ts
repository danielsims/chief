import type { z } from "zod";

import type { BrowserCredentialSetupRecipe } from "./integration-setup-recipes.js";
import {
  connectionListSchema,
  emptyResponseSchema,
  integrationListSchema,
  policySchema,
  toolListSchema,
} from "./tools/executor-api-schemas.js";

interface Manifest {
  connection: {
    apiBaseUrl: string;
    auth:
      | { kind: "bearer"; token: string }
      | { kind: "oauth"; accessToken: string }
      | { kind: "basic"; username?: string; password: string };
  };
}

interface Integration {
  slug: string;
  name?: string;
  displayUrl?: string;
  authMethods?: {
    kind?: string;
    template?: string;
    placements?: { carrier?: string; name?: string; prefix?: string }[];
  }[];
}

interface Tool {
  address: string;
  name: string;
  requiresApproval?: boolean | null;
}

type Request = <T>(
  manifest: Manifest,
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
) => Promise<T>;

const prepared = new Set<string>();
const setupToolNames = new Set([
  "coreTools.connections.create",
  "coreTools.oauth.clients.create",
  "coreTools.oauth.start",
  "graphql.addIntegration",
  "mcp.addServer",
  "openapi.addSpec",
]);
const bearerAuthentication = [
  {
    slug: "token",
    type: "apiKey",
    label: "Access token",
    headers: {
      Authorization: ["Bearer ", { type: "variable", name: "token" }],
    },
  },
];

export function policyMatches(pattern: string, tool: string) {
  if (pattern === "*") return true;
  const patternSegments = pattern.split(".");
  const toolSegments = tool.split(".");
  for (let index = 0; index < patternSegments.length; index += 1) {
    const segment = patternSegments[index];
    if (segment === "*") {
      return (
        index === patternSegments.length - 1 || index < toolSegments.length
      );
    }
    if (segment !== toolSegments[index]) return false;
  }
  return patternSegments.length === toolSegments.length;
}

export async function configureReadOnlyConnectionPolicies(
  manifest: Manifest,
  tools: Tool[],
  request: Request,
) {
  const policies = await request(manifest, "/policies", policySchema.array());
  for (const tool of tools.filter((candidate) => candidate.requiresApproval)) {
    const pattern = tool.address.replace(/^tools\./, "");
    if (
      !policies.some(
        (policy) =>
          policy.owner === "org" &&
          policy.action !== "approve" &&
          policyMatches(policy.pattern, pattern),
      ) &&
      !policies.some(
        (policy) => policy.owner === "org" && policy.pattern === pattern,
      )
    ) {
      await request(manifest, "/policies", emptyResponseSchema, {
        method: "POST",
        body: JSON.stringify({ owner: "org", pattern, action: "approve" }),
      });
    }
  }
}

export async function configureBrowserCredentialIntegration(
  manifest: Manifest,
  recipe: BrowserCredentialSetupRecipe,
  request: Request,
) {
  const key = `${manifest.connection.apiBaseUrl}\0${recipe.id}`;
  if (prepared.has(key)) return;
  const integrations = await request(
    manifest,
    "/integrations",
    integrationListSchema,
  );
  const spec = { kind: "url", url: recipe.integration.specUrl };
  if (integrations.some((item) => item.slug === recipe.integration.slug)) {
    await request(
      manifest,
      `/openapi/integrations/${recipe.integration.slug}/spec`,
      emptyResponseSchema,
      { method: "POST", body: JSON.stringify({ spec }) },
    );
    await request(
      manifest,
      `/openapi/integrations/${recipe.integration.slug}/config`,
      emptyResponseSchema,
      {
        method: "POST",
        body: JSON.stringify({
          mode: "replace",
          authenticationTemplate: bearerAuthentication,
          baseUrl: recipe.integration.baseUrl,
        }),
      },
    );
  } else {
    await request(manifest, "/openapi/specs", emptyResponseSchema, {
      method: "POST",
      body: JSON.stringify({
        spec,
        slug: recipe.integration.slug,
        name: recipe.integration.name,
        description: recipe.integration.description,
        family: recipe.integration.family,
        baseUrl: recipe.integration.baseUrl,
        authenticationTemplate: bearerAuthentication,
      }),
    });
  }
  prepared.add(key);
}

export async function configureIntegrationSetupPolicies(
  manifest: Manifest,
  request: Request,
  policyMatches: (pattern: string, tool: string) => boolean,
) {
  const [tools, policies] = await Promise.all([
    request(manifest, "/tools?includeAnnotations=true", toolListSchema),
    request(manifest, "/policies", policySchema.array()),
  ]);
  for (const tool of tools) {
    const pattern = tool.address.replace(/^tools\./, "");
    if (
      !pattern.startsWith("executor.") ||
      !setupToolNames.has(tool.name) ||
      policies.some(
        (policy) =>
          policy.owner === "org" &&
          policy.action !== "approve" &&
          policyMatches(policy.pattern, pattern),
      ) ||
      policies.some(
        (policy) => policy.owner === "org" && policy.pattern === pattern,
      )
    ) {
      continue;
    }
    await request(manifest, "/policies", emptyResponseSchema, {
      method: "POST",
      body: JSON.stringify({ owner: "org", pattern, action: "approve" }),
    });
  }
}

function domainMatches(domain: string, integration: Integration) {
  if (!integration.displayUrl) return false;
  try {
    const hostname = new URL(integration.displayUrl).hostname.toLowerCase();
    const expected = domain.toLowerCase();
    return hostname === expected || hostname.endsWith(`.${expected}`);
  } catch {
    return false;
  }
}

export async function storeBrowserGeneratedCredential(
  manifest: Manifest,
  input: { domain: string; integrationSlug: string; credential: string },
  request: Request,
) {
  const integrations = await request(
    manifest,
    "/integrations",
    integrationListSchema,
  );
  const integration = integrations.find(
    (candidate) => candidate.slug === input.integrationSlug,
  );
  if (!integration || !domainMatches(input.domain, integration)) {
    throw new Error(
      "The prepared connection does not belong to the active integration.",
    );
  }
  const auth = integration.authMethods?.find(
    (method) =>
      method.kind === "apikey" &&
      method.template &&
      method.placements?.some(
        (placement) =>
          placement.carrier === "header" &&
          placement.name?.toLowerCase() === "authorization" &&
          placement.prefix?.trim().toLowerCase() === "bearer",
      ),
  );
  if (!auth?.template) {
    throw new Error(
      "The prepared integration does not expose a bearer-token connection.",
    );
  }
  const connectionName = "chief";
  const connections = await request(
    manifest,
    `/connections?integration=${encodeURIComponent(integration.slug)}&owner=org`,
    connectionListSchema,
  );
  if (
    connections.some(
      (connection) =>
        connection.integration === integration.slug &&
        connection.owner === "org" &&
        connection.name === connectionName,
    )
  ) {
    await request(
      manifest,
      `/connections/org/${encodeURIComponent(integration.slug)}/${connectionName}`,
      emptyResponseSchema,
      { method: "DELETE" },
    );
  }
  await request(manifest, "/connections", emptyResponseSchema, {
    method: "POST",
    body: JSON.stringify({
      owner: "org",
      name: connectionName,
      integration: integration.slug,
      template: auth.template,
      value: input.credential,
      identityLabel: `Chief - ${integration.name ?? input.domain}`,
    }),
  });
  return { connectionName, integrationSlug: integration.slug };
}
