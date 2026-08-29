import type {
  JsonObject,
  Principal,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  pluginAuthorizationPayloadSchema,
  pluginRecommendationPayloadSchema,
} from "@chief/relay-contracts";

import { HttpError } from "./http";

export function validatePluginComponentPlacement(
  components: readonly {
    kind: string;
    payload: JsonObject;
  }[],
  principal: Principal,
  workspaceId: WorkspaceId,
  conversationId: string,
  threadRootId?: string,
) {
  for (const component of components) {
    const parsed =
      component.kind === "plugin.recommendation"
        ? pluginRecommendationPayloadSchema.parse(component.payload)
        : component.kind === "plugin.authorization"
          ? pluginAuthorizationPayloadSchema.parse(component.payload)
          : undefined;
    if (!parsed) continue;
    if (
      parsed.workspaceId !== workspaceId ||
      parsed.conversationId !== conversationId ||
      parsed.threadRootId !== threadRootId
    ) {
      throw new HttpError(
        409,
        "plugin_component_scope_mismatch",
        "The plugin component does not match its relay placement.",
      );
    }
    if (
      (component.kind === "plugin.recommendation" ||
        component.kind === "plugin.authorization") &&
      (principal.kind !== "agent" ||
        !("agentId" in parsed) ||
        parsed.agentId !== principal.agentId)
    ) {
      throw new HttpError(
        403,
        "plugin_component_author_mismatch",
        "Only the owning agent may publish this plugin recommendation.",
      );
    }
  }
}
