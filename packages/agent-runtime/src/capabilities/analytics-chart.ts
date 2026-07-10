import type { AgentCapability } from "./types.js";

/** Analytics data in, typed conversational chart out. */
export const analyticsChartCapability: AgentCapability = {
  id: "analytics-chart",
  toolName: "agentTools.uiPresentChart",
  partType: "data-chart",
  instructions: `Inline charts are generative UI components, not files. When the user asks for a chart, or a time series materially helps the answer, call tools.marketer.org.workspace.agentTools.uiPresentChart({ body: { title, subtitle, xLabel, yLabel, series: [{ label, points: [{ x, value }] }] } }) inside Executor. Use trustworthy rows already in the conversation or fetch them first with analyticsRunReport and a date dimension. The presentChart result becomes a typed data-chart part that Marketer renders directly inside the chat. Never create, edit, or link SVG, PNG, HTML, CSV, or other local chart files, and never use file-change or shell commands to draw a chart.`,
};
