import { listProspectsTool } from "./list-prospects.js";
import { listTrendsTool } from "./list-trends.js";
import { saveProspectTool } from "./save-prospect.js";
import { saveTrendTool } from "./save-trend.js";

export const researchToolkit = [
  listProspectsTool,
  saveProspectTool,
  listTrendsTool,
  saveTrendTool,
] as const;
