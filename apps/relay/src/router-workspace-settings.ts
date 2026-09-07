import { z } from "zod";

import { updateOrganizationSettings } from "@chief/auth/d1-organizations";
import { workspaceIdSchema } from "@chief/relay-contracts";

import { AuthorizationError } from "./auth";
import { json, relayError } from "./http";
import { authenticateRelayRequest, requireAccountBinding } from "./router-auth";
import { authorizeWorkspace } from "./workspace-authority";
import { readWorkspaceSettings } from "./workspace-settings";

const route = /^\/v1\/workspaces\/([^/]+)\/settings$/u;
const settingsSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    website: z.union([
      z.literal(""),
      z.url({ protocol: /^https?$/u }).max(2048),
    ]),
    imageURL: z
      .url({ protocol: /^https?$/u })
      .max(2048)
      .nullable(),
  })
  .strict();

export async function routeWorkspaceSettings(
  env: Env,
  request: Request,
  requestId: string,
) {
  const match = route.exec(new URL(request.url).pathname);
  if (!match || !["GET", "PATCH"].includes(request.method)) return undefined;
  const workspaceId = workspaceIdSchema.parse(match[1]);
  const auth = await authenticateRelayRequest(request, env);
  requireAccountBinding(env, auth.bound);
  const principal = await authorizeWorkspace(env, {
    identity: auth.identity,
    workspaceId,
    requestId,
  });
  if (principal.kind !== "user" || principal.role !== "owner") {
    throw new AuthorizationError(
      "Only the workspace owner can manage settings.",
    );
  }
  if (request.method === "PATCH") {
    const result = settingsSchema.safeParse(await auth.request.json());
    if (!result.success)
      return relayError(
        400,
        "invalid_settings",
        "Check the workspace name and URLs.",
      );
    const updated = await updateOrganizationSettings(env.AUTH_DB, {
      ...result.data,
      workspaceId,
      userId: principal.userId,
    });
    if (!updated)
      throw new AuthorizationError("Workspace ownership is required.");
    return json(result.data);
  }
  const settings = await readWorkspaceSettings(env, workspaceId);
  if (!settings)
    return relayError(404, "workspace_not_found", "Workspace not found.");
  return json(settings);
}
