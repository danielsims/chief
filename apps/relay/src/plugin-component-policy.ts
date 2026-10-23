import type {
  JsonObject,
  Principal,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  attachmentLocation,
  messageAttachmentPayloadSchema,
  pluginAuthorizationPayloadSchema,
  pluginRecommendationPayloadSchema,
  projectRecommendationPayloadSchema,
  questionPayloadSchema,
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
    // An attached image must be one uploaded to this conversation, so a
    // message can't point readers at another channel's files.
    if (component.kind === "attachment") {
      const location = attachmentLocation(
        messageAttachmentPayloadSchema.parse(component.payload).url,
      );
      if (
        location?.workspaceId !== workspaceId ||
        location.conversationId !== conversationId
      )
        throw new HttpError(
          409,
          "attachment_scope_mismatch",
          "Attach images uploaded to this conversation.",
        );
      continue;
    }
    if (component.kind === "schedule.run" && principal.kind !== "service")
      throw new HttpError(
        403,
        "schedule_component_author",
        "Only the relay can announce scheduled runs.",
      );
    const parsed =
      component.kind === "plugin.recommendation"
        ? pluginRecommendationPayloadSchema.parse(component.payload)
        : component.kind === "plugin.authorization"
          ? pluginAuthorizationPayloadSchema.parse(component.payload)
          : component.kind === "project.recommendation"
            ? projectRecommendationPayloadSchema.parse(component.payload)
            : component.kind === "question"
              ? questionPayloadSchema.parse(component.payload)
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
        component.kind === "plugin.authorization" ||
        component.kind === "project.recommendation" ||
        component.kind === "question") &&
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
