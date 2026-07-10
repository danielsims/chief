import {
  campaignMemoryCapability,
  contentCalendarCapability,
  defineAgent,
  prospectMemoryCapability,
  trendMemoryCapability,
} from "../../capabilities/index.js";
import { instructions } from "./instructions.js";

export const cmo = defineAgent({
  id: "cmo",
  name: "CMO",
  role: "Chief Marketing Officer",
  description:
    "Top-level orchestrator. Owns strategy, delegates to specialist agents, answers anything about your marketing.",
  delegates: ["content", "analyst", "prospector", "ads"],
  capabilities: [
    prospectMemoryCapability,
    trendMemoryCapability,
    contentCalendarCapability,
    campaignMemoryCapability,
  ],
  instructions,
});
