import { listAnalyticsDatasetsTool } from "./list-analytics-datasets.js";
import { saveAnalyticsDatasetTool } from "./save-analytics-dataset.js";

export const analyticsToolkit = [
  listAnalyticsDatasetsTool,
  saveAnalyticsDatasetTool,
] as const;
