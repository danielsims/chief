import { jsonResponse } from "../../response.js";
import { defineLocalTool } from "../../tool.js";

export const listAnalyticsDatasetsTool = defineLocalTool({
  method: "GET",
  path: "/local-tools/analytics/datasets",
  operation: {
    operationId: "analytics.listDatasets",
    summary: "List saved analytics datasets",
  },
  async execute({ manager, request, workspaceId }) {
    const data = await manager.workspaceData(workspaceId);
    const provider = new URL(request.url).searchParams.get("provider");
    return jsonResponse({
      datasets: provider
        ? data.analyticsDatasets.filter(
            (dataset) => dataset.provider === provider,
          )
        : data.analyticsDatasets,
    });
  },
});
