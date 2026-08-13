import type { IntegrationSetupRegistry } from "./integration-setup-state.js";
import type { SetupSkill } from "./setup-skills.js";
import type { ExecutorCapability } from "./types.js";
import { SETUP_ATTEMPT_PREFIX } from "./server-message-helpers.js";
import { prepareIntegrationSetup } from "./tools/control-plane.js";

export async function activateRequestedIntegrationSetup({
  capability,
  chatId,
  integrationSetups,
  setupSkill,
  text,
  workspaceId,
}: {
  capability: ExecutorCapability;
  chatId: string;
  integrationSetups: IntegrationSetupRegistry;
  setupSkill: SetupSkill | undefined;
  text: string;
  workspaceId: string;
}) {
  const firstLine = text.split("\n", 1)[0] ?? "";
  if (!firstLine.startsWith(SETUP_ATTEMPT_PREFIX) || !firstLine.endsWith("]")) {
    return;
  }
  const domain =
    setupSkill?.domain ?? integrationSetups.domain(workspaceId, chatId);
  const attemptId = firstLine.slice(SETUP_ATTEMPT_PREFIX.length, -1);
  if (!domain || !attemptId) return;

  const prepared = await prepareIntegrationSetup(
    workspaceId,
    capability,
    domain,
  );
  integrationSetups.activate(workspaceId, chatId, {
    attemptId,
    domain,
    integrationSlug: prepared.integrationSlug,
    recipeId: prepared.recipeId,
  });
}
