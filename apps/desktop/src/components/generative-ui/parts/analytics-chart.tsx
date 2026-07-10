import { LineChartCard } from "../../charts/line-chart-card";
import { shortAnalyticsDate } from "../../integrations/connection-preview";
import type { GenerativePartRenderer } from "../types";

const analyticsChartRenderer: GenerativePartRenderer = {
  capability: "analytics-chart",
  partType: "data-chart",
  render(part) {
    if (part.type !== "data-chart") return undefined;
    return (
      <LineChartCard
        title={part.data.title}
        subtitle={part.data.subtitle}
        series={part.data.series}
        formatX={shortAnalyticsDate}
      />
    );
  },
};

export default analyticsChartRenderer;
