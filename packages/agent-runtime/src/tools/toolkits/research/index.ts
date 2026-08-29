import { listProspectsTool } from "../../runtime/research/list-prospects.js";
import { saveProspectTool } from "../../runtime/research/save-prospect.js";
import { listTrendsTool } from "./list-trends.js";
import { saveTrendTool } from "./save-trend.js";

export const researchToolkit = [
  listProspectsTool,
  saveProspectTool,
  listTrendsTool,
  saveTrendTool,
] as const;
