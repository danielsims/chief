import { listTrendsTool } from "./list-trends.js";
import { saveTrendTool } from "./save-trend.js";

export const researchToolkit = [listTrendsTool, saveTrendTool] as const;
