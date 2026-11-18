import type { GenerativePartRenderer } from "../types";
import { AutomationCard } from "../../automations/automation-card";

const renderer: GenerativePartRenderer = {
  partType: "data-automation",
  render: (part) =>
    part.type === "data-automation" ? (
      <AutomationCard data={part.data} />
    ) : undefined,
};

export default renderer;
