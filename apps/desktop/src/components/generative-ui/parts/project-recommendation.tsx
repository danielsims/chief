import type { GenerativeProjectRecommendationBlock } from "@chief/agent-runtime/types";

import type { GenerativePartRenderer } from "../types";
import { ProjectConnectCard } from "../../chat/project-connect-card";

function ProjectRecommendationPart({
  part,
}: {
  part: GenerativeProjectRecommendationBlock;
}) {
  return <ProjectConnectCard recommendation={part.data} />;
}

const renderer: GenerativePartRenderer = {
  partType: "data-project-recommendation",
  render: (part) =>
    part.type === "data-project-recommendation" ? (
      <ProjectRecommendationPart part={part} />
    ) : undefined,
};

export default renderer;
