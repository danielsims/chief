import type { ZodType } from "zod";

import type {
  JsonObject,
  Principal,
  WorkspaceId,
} from "@chief/relay-contracts";
import {
  attachmentLocation,
  automationCardPayloadSchema,
  messageAttachmentPayloadSchema,
  pluginAuthorizationPayloadSchema,
  pluginRecommendationPayloadSchema,
  projectRecommendationPayloadSchema,
  questionPayloadSchema,
} from "@chief/relay-contracts";

import { HttpError } from "./http";

/**
 * Cards that belong to one place in one conversation. Each is checked
 * against where it is posted, and only the agent named on it may post it.
 * A new card kind registers here.
 */
const placedComponents = new Map<
  string,
  ZodType<{
    workspaceId: string;
    conversationId: string;
    threadRootId?: string;
    agentId: string;
  }>
>([
  ["plugin.recommendation", pluginRecommendationPayloadSchema],
  ["plugin.authorization", pluginAuthorizationPayloadSchema],
  ["project.recommendation", projectRecommendationPayloadSchema],
  ["question", questionPayloadSchema],
  ["automation", automationCardPayloadSchema],
]);

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
    const schema = placedComponents.get(component.kind);
    if (!schema) continue;
    const parsed = schema.parse(component.payload);
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
    if (principal.kind !== "agent" || parsed.agentId !== principal.agentId) {
      throw new HttpError(
        403,
        "plugin_component_author_mismatch",
        "Only the owning agent may publish this plugin recommendation.",
      );
    }
  }
}
