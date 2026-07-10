import { analyticsChartCapability } from "./analytics-chart.js";
import { contentCalendarCapability } from "./content-calendar.js";
import { prospectMemoryCapability } from "./prospect-memory.js";
import { trendMemoryCapability } from "./trend-memory.js";

export {
  analyticsChartCapability,
  contentCalendarCapability,
  prospectMemoryCapability,
  trendMemoryCapability,
};
export const availableCapabilities = [
  analyticsChartCapability,
  prospectMemoryCapability,
  trendMemoryCapability,
  contentCalendarCapability,
] as const;
export { composeAgentCapabilities, defineAgent } from "./types.js";
export type { AgentCapability } from "./types.js";
