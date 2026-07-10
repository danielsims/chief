import {
  analyticsChartCapability,
  defineAgent,
} from "../../capabilities/index.js";
import { instructions } from "./instructions.js";

export const analyst = defineAgent({
  id: "analyst",
  name: "Analyst",
  role: "Analytics & Reporting",
  description:
    "Reviews website traffic, signups, SEO, funnels and content performance across connected channels.",
  capabilities: [analyticsChartCapability],
  instructions,
});
