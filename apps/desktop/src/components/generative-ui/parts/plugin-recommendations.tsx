import type { GenerativePluginRecommendationsBlock } from "@chief/agent-runtime/types";

import type { GenerativePartRenderer } from "../types";
import { PluginRecommendationCards } from "../../chat/plugin-tool-card";

function PluginRecommendationsPart({
  part,
}: {
  part: GenerativePluginRecommendationsBlock;
}) {
  const data = part.data;
  const actionContext =
    data.workspaceId &&
    data.conversationId &&
    data.agentId &&
    data.recommendationId
      ? {
          workspaceId: data.workspaceId,
          conversationId: data.conversationId,
          ...(data.threadRootId
            ? { threadRootId: data.threadRootId }
            : undefined),
          agentId: data.agentId,
          recommendationId: data.recommendationId,
        }
      : undefined;
  return (
    <PluginRecommendationCards
      plugins={data.plugins}
      actionContext={actionContext}
      authorizations={data.authorizations}
    />
  );
}

const renderer: GenerativePartRenderer = {
  partType: "data-plugin-recommendations",
  render: (part) =>
    part.type === "data-plugin-recommendations" ? (
      <PluginRecommendationsPart part={part} />
    ) : undefined,
};

export default renderer;
