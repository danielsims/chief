import type { GenerativePluginRecommendationsBlock } from "@chief/agent-runtime/types";

import type { GenerativePartRenderer } from "../types";
import { PluginRecommendationCards } from "../../chat/plugin-tool-card";

function PluginRecommendationsPart({
  part,
}: {
  part: GenerativePluginRecommendationsBlock;
}) {
  const data = part.data;
  return (
    <PluginRecommendationCards
      plugins={data.plugins}
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
