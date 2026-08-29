import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(
  await readFile(join(here, "chief-agent-observability.json"), "utf8"),
);
const output = join(here, "dashboards", "chief");
await mkdir(output, { recursive: true });

const agent = structuredClone(source);
agent.panels = source.panels.filter((panel) => panel.id <= 7);
agent.panels[0].options.content =
  "# Chief agent observability\nInspect agent workflows, model calls, tools, failures, and durable turn storage. Filter by relay, workspace, workflow, agent, or channel, then open a trace for the complete Tempo waterfall.";
agent.version = 1;

const duration = structuredClone(source);
duration.uid = "chief-agent-duration";
duration.title = "Chief Agent Duration";
duration.description =
  "Agent execution duration segmented by relay, workspace, and time window.";
duration.panels = source.panels
  .filter((panel) => panel.id >= 8)
  .map((panel, index) => ({
    ...panel,
    gridPos: { ...panel.gridPos, y: index === 0 ? 3 : 3 + index * 9 },
  }));
duration.panels.unshift({
  id: 1,
  type: "text",
  title: "How to use this dashboard",
  gridPos: { h: 3, w: 24, x: 0, y: 0 },
  options: {
    mode: "markdown",
    content:
      "# Chief agent duration\nTrack p95 and total traced agent execution time by relay and workspace. Use minute, hour, and day windows to isolate spikes before comparing changes.",
  },
});
duration.version = 1;

const onboarding = dashboard("chief-onboarding", "Chief Onboarding", [
  textPanel(
    1,
    0,
    3,
    "# Chief onboarding\nFollow workspace creation from first view to completion. Events contain operational metadata only. Company names, emails, API keys, and selected app names are never exported.",
  ),
  statPanel(2, 3, 0, "Started", "workspace-profile", "viewed"),
  statPanel(3, 3, 6, "Hosting reached", "agent-hosting", "viewed"),
  statPanel(4, 3, 12, "Apps reached", "apps", "viewed"),
  statPanel(5, 3, 18, "Completed", "workspace-create", "completed"),
  timeseriesPanel(
    6,
    9,
    "Onboarding funnel over time",
    '{ resource.service.name = "chief-relay" && resource.chief.relay.id =~ "${relay:raw}" && name = "chief.onboarding" } | count_over_time() by (span.chief.onboarding.stage, span.chief.onboarding.event)',
  ),
  timeseriesPanel(
    7,
    18,
    "Failures by error code",
    '{ resource.service.name = "chief-relay" && resource.chief.relay.id =~ "${relay:raw}" && name = "chief.onboarding" && span.chief.onboarding.event = "failed" } | count_over_time() by (span.chief.onboarding.error.code)',
  ),
  traceTable(
    8,
    27,
    "Recent onboarding activity",
    '{ resource.service.name = "chief-relay" && resource.chief.relay.id =~ "${relay:raw}" && name = "chief.onboarding" && span.chief.onboarding.stage =~ "${stage:raw}" && span.chief.onboarding.event =~ "${event:raw}" } | select(span.chief.onboarding.session.id, span.chief.onboarding.stage, span.chief.onboarding.event, span.chief.onboarding.hosting, span.chief.onboarding.provider, span.chief.onboarding.selected_app_count, span.chief.onboarding.error.code, span.chief.workspace.id)',
  ),
]);

await Promise.all([
  save("agent-observability.json", agent),
  save("agent-duration.json", duration),
  save("onboarding.json", onboarding),
]);

function dashboard(uid, title, panels) {
  return {
    ...structuredClone(source),
    uid,
    title,
    description: "Workspace onboarding funnel and failure telemetry.",
    panels,
    templating: {
      list: [
        textbox("relay", "Relay"),
        textbox("stage", "Stage"),
        textbox("event", "Outcome"),
      ],
    },
    version: 1,
  };
}

function textbox(name, label) {
  return {
    name,
    label,
    type: "textbox",
    query: ".*",
    current: { text: ".*", value: ".*" },
    options: [{ selected: true, text: ".*", value: ".*" }],
  };
}

function textPanel(id, y, h, content) {
  return {
    id,
    type: "text",
    title: "How to use this dashboard",
    gridPos: { h, w: 24, x: 0, y },
    options: { mode: "markdown", content },
  };
}

function statPanel(id, y, x, title, stage, event) {
  return {
    id,
    type: "stat",
    title,
    datasource: tempo(),
    gridPos: { h: 6, w: 6, x, y },
    fieldConfig: { defaults: { decimals: 0 }, overrides: [] },
    options: {
      colorMode: "value",
      graphMode: "area",
      justifyMode: "auto",
      reduceOptions: { calcs: ["sum"], fields: "", values: false },
      textMode: "auto",
    },
    targets: [
      traceTarget(
        `{ resource.service.name = "chief-relay" && resource.chief.relay.id =~ "\${relay:raw}" && name = "chief.onboarding" && span.chief.onboarding.stage = "${stage}" && span.chief.onboarding.event = "${event}" } | count_over_time()`,
      ),
    ],
  };
}

function timeseriesPanel(id, y, title, query) {
  return {
    id,
    type: "timeseries",
    title,
    datasource: tempo(),
    gridPos: { h: 9, w: 24, x: 0, y },
    fieldConfig: { defaults: { decimals: 0 }, overrides: [] },
    options: {
      legend: {
        calcs: ["sum", "max"],
        displayMode: "table",
        placement: "bottom",
        showLegend: true,
      },
      tooltip: { mode: "multi", sort: "desc" },
    },
    targets: [traceTarget(query)],
  };
}

function traceTable(id, y, title, query) {
  return {
    id,
    type: "table",
    title,
    datasource: tempo(),
    gridPos: { h: 12, w: 24, x: 0, y },
    fieldConfig: { defaults: {}, overrides: [] },
    options: { cellHeight: "sm", showHeader: true },
    targets: [
      {
        ...traceTarget(query),
        limit: 250,
        tableType: "spans",
      },
    ],
  };
}

function traceTarget(query) {
  return {
    refId: "A",
    datasource: tempo(),
    queryType: "traceql",
    metricsQueryType: "range",
    serviceMapUseNativeHistograms: false,
    query,
  };
}

function tempo() {
  return { type: "tempo", uid: "tempo" };
}

async function save(name, value) {
  await writeFile(join(output, name), `${JSON.stringify(value, null, 2)}\n`);
}
