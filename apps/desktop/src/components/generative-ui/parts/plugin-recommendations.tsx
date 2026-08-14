import type { GenerativePluginRecommendationsBlock } from "@chief/agent-runtime/types";

import type { GenerativePartRenderer } from "../types";
import { PluginRecommendationCards } from "../../chat/plugin-tool-card";

function PluginRecommendationsPart({
  part,
}: {
  part: GenerativePluginRecommendationsBlock;
}) {
  return <PluginRecommendationCards plugins={part.data.plugins} />;
}

const renderer: GenerativePartRenderer = {
  partType: "data-plugin-recommendations",
  render: (part) =>
    part.type === "data-plugin-recommendations" ? (
      <PluginRecommendationsPart part={part} />
    ) : undefined,
};

export default renderer;
