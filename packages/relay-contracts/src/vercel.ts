import { z } from "zod";

export const vercelTeamOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  slug: z.string(),
});

export const vercelProjectOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  framework: z.string().optional(),
  productionDeploymentUrl: z.string().url().optional(),
});

export const vercelDestinationCatalogSchema = z.object({
  teams: z.array(vercelTeamOptionSchema),
  projects: z.array(vercelProjectOptionSchema),
  selectedTeamId: z.string().optional(),
});

export const vercelConnectCommandSchema = z.object({
  token: z.string().trim().min(1).max(20_000),
});

export const eveAgentEnvironmentSchema = z.object({
  CHIEF_AGENT_ID: z.string().min(1),
  CHIEF_CHANNEL_TOKEN: z.string().min(1),
  CHIEF_DELIVERY_SIGNING_KEY_ID: z.string().min(1),
  CHIEF_DELIVERY_SIGNING_SECRET: z.string().min(1),
  CHIEF_RELAY_URL: z.string().url(),
  CHIEF_WORKSPACE_ID: z.string().min(1),
});

export const vercelEveProjectDestinationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("existing"),
    projectId: z.string().min(1),
    projectName: z.string().min(1),
  }),
  z.object({ kind: z.literal("new"), projectName: z.string().min(1) }),
]);

export const eveAgentProvisioningInputSchema = z.object({
  teamId: z.string().min(1),
  project: vercelEveProjectDestinationSchema,
  agent: z.object({
    name: z.string().min(1),
    description: z.string(),
    instructions: z.string().min(1),
    model: z.string().min(1),
  }),
  environment: eveAgentEnvironmentSchema,
});

export const eveAgentProvisioningResultSchema = z.object({
  projectId: z.string().min(1),
  deploymentId: z.string().min(1),
  deploymentUrl: z.string().url(),
  inspectorUrl: z.string().url().optional(),
});

export type VercelDestinationCatalog = z.infer<
  typeof vercelDestinationCatalogSchema
>;
export type EveAgentProvisioningInput = z.infer<
  typeof eveAgentProvisioningInputSchema
>;
export type EveAgentProvisioningResult = z.infer<
  typeof eveAgentProvisioningResultSchema
>;
