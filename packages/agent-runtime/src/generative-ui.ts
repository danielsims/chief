import type {
  AgentEvent,
  ContentBlock,
  GenerativeChartBlock,
  GenerativeChartData,
  GenerativeDocumentBlock,
} from "./types.js";

interface ReportColumn {
  kind?: string;
  name?: string;
}

interface ReportData {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  range?: { startDate?: string; endDate?: string };
  source?: { provider?: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        isRecord(part) && typeof part.text === "string" ? part.text : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return isRecord(content) ? JSON.stringify(content) : "";
}

/** Parses JSON that may sit after a prose prefix ("[log] Chart result: {…}"). */
function looseJsonParse(text: string): unknown {
  for (const start of [text.indexOf("{"), text.indexOf("[")]) {
    if (start < 0) continue;
    try {
      return JSON.parse(text.slice(start));
    } catch {
      // The other start may still be real JSON (e.g. "[log] {…}").
    }
  }
  return undefined;
}

function parseJsonCandidates(text: string): unknown[] {
  const candidates = new Set<string>();
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    candidates.add(trimmed);
  }
  for (const line of text.split("\n")) {
    const log = /^\s*\[log\]\s+(.+)\s*$/.exec(line)?.[1];
    if (log) candidates.add(log);
  }

  const parsed: unknown[] = [];
  for (const candidate of candidates) {
    try {
      parsed.push(JSON.parse(candidate));
    } catch {
      // Tool output often mixes prose and logs. Only complete JSON records
      // are eligible to become persistent UI data parts.
      const loose = looseJsonParse(candidate);
      if (loose !== undefined) parsed.push(loose);
    }
  }
  // Executor execute results carry console output as `logs` strings, and
  // agents often log a tool's return value instead of returning it — mine
  // those strings (multi-line pretty JSON included) as candidates too.
  for (const item of [...parsed]) {
    if (!isRecord(item) || !Array.isArray(item.logs)) continue;
    for (const log of item.logs) {
      if (typeof log !== "string") continue;
      const loose = looseJsonParse(log);
      if (loose !== undefined) parsed.push(loose);
    }
  }
  return parsed;
}

function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function providerLabel(provider: string) {
  if (provider === "google-analytics") return "Google Analytics";
  if (provider === "google-ads") return "Google Ads";
  return humanize(provider);
}

function reportLabel(key: string, report: ReportData) {
  const base = humanize(key || "Series");
  const start = report.range?.startDate;
  const end = report.range?.endDate;
  return start && end ? `${base} · ${start}–${end}` : base;
}

function collectReports(
  value: unknown,
  key = "series",
  reports: { key: string; data: ReportData }[] = [],
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectReports(item, `${key} ${index + 1}`, reports),
    );
    return reports;
  }
  if (!isRecord(value)) return reports;

  if (Array.isArray(value.columns) && Array.isArray(value.rows)) {
    reports.push({ key, data: value as unknown as ReportData });
    return reports;
  }

  for (const [childKey, child] of Object.entries(value)) {
    collectReports(child, childKey === "data" ? key : childKey, reports);
  }
  return reports;
}

function explicitChart(value: unknown): GenerativeChartData | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const chart = explicitChart(item);
      if (chart) return chart;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (
    value.type === "data-chart" &&
    isRecord(value.data) &&
    value.data.kind === "line" &&
    typeof value.data.title === "string" &&
    typeof value.data.yLabel === "string" &&
    Array.isArray(value.data.series)
  ) {
    const series = value.data.series.flatMap((candidate, index) => {
      if (!isRecord(candidate) || !Array.isArray(candidate.points)) return [];
      const points = candidate.points.flatMap((point) => {
        if (!isRecord(point)) return [];
        return typeof point.x === "string" &&
          typeof point.value === "number" &&
          Number.isFinite(point.value)
          ? [{ x: point.x, value: point.value }]
          : [];
      });
      if (points.length < 2) return [];
      return [
        {
          id:
            typeof candidate.id === "string"
              ? candidate.id
              : `series-${index + 1}`,
          label:
            typeof candidate.label === "string"
              ? candidate.label
              : `Series ${index + 1}`,
          points,
        },
      ];
    });
    if (series.length === 0) return null;
    return {
      kind: "line",
      title: value.data.title,
      subtitle:
        typeof value.data.subtitle === "string"
          ? value.data.subtitle
          : undefined,
      xLabel:
        typeof value.data.xLabel === "string" ? value.data.xLabel : undefined,
      yLabel: value.data.yLabel,
      series,
    };
  }
  for (const child of Object.values(value)) {
    const chart = explicitChart(child);
    if (chart) return chart;
  }
  return null;
}

function chartFromContent(
  toolUseId: string,
  content: unknown,
): GenerativeChartBlock | null {
  const candidates = parseJsonCandidates(toolResultText(content));
  for (const candidate of candidates) {
    const data = explicitChart(candidate);
    if (data) return { type: "data-chart", id: `chart-${toolUseId}`, data };
  }
  const reports = candidates.flatMap((candidate) => collectReports(candidate));
  const chartable = reports.flatMap(({ key, data }) => {
    const dimension = data.columns.find(
      (column) => column.kind === "dimension" && column.name,
    )?.name;
    const metric = data.columns.find(
      (column) => column.kind === "metric" && column.name,
    )?.name;
    if (!dimension || !metric || data.rows.length < 2) return [];
    const points = data.rows.flatMap((row) => {
      const x = row[dimension];
      const value = row[metric];
      return (typeof x === "string" || typeof x === "number") &&
        typeof value === "number" &&
        Number.isFinite(value)
        ? [{ x: String(x), value }]
        : [];
    });
    if (points.length < 2) return [];
    return [{ key, data, dimension, metric, points }];
  });
  if (chartable.length === 0) return null;

  const metric = chartable[0]!.metric;
  const dimension = chartable[0]!.dimension;
  const provider = chartable[0]!.data.source?.provider;
  const data: GenerativeChartData = {
    kind: "line",
    title: humanize(metric),
    subtitle: provider
      ? `Generated from ${providerLabel(provider)}`
      : "Generated from connected analytics",
    xLabel: humanize(dimension),
    yLabel: humanize(metric),
    series: chartable.slice(0, 4).map((report, index) => ({
      id: `${toolUseId}-${index}`,
      label: reportLabel(report.key, report.data),
      points: report.points,
    })),
  };
  return { type: "data-chart", id: `chart-${toolUseId}`, data };
}

function documentFromContent(content: unknown): GenerativeDocumentBlock | null {
  const visit = (value: unknown): GenerativeDocumentBlock | null => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
      return null;
    }
    if (!isRecord(value)) return null;
    const file = isRecord(value.file) ? value.file : value;
    if (
      typeof file.id === "string" &&
      typeof file.name === "string" &&
      typeof file.path === "string" &&
      typeof file.currentVersionId === "string" &&
      (file.kind === "document" || file.kind === "email")
    ) {
      return {
        type: "data-document",
        id: `document-${file.id}`,
        data: {
          fileId: file.id,
          title: file.name,
          path: file.path,
          kind: file.kind,
          versionId: file.currentVersionId,
        },
      };
    }
    for (const child of Object.values(value)) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  for (const candidate of parseJsonCandidates(toolResultText(content))) {
    const found = visit(candidate);
    if (found) return found;
  }
  return null;
}

/** Add AI SDK-style data parts once, after provider messages are normalized. */
export function withGenerativeDataParts(event: AgentEvent): AgentEvent {
  if (event.type !== "message") return event;
  const existingChartIds = new Set(
    event.content.flatMap((block) =>
      block.type === "data-chart" && block.id ? [block.id] : [],
    ),
  );
  const existingDocumentIds = new Set(
    event.content.flatMap((block) =>
      block.type === "data-document" && block.id ? [block.id] : [],
    ),
  );
  const content: ContentBlock[] = [];
  for (const block of event.content) {
    content.push(block);
    if (block.type !== "tool_result" || block.is_error) continue;
    const chart = chartFromContent(block.tool_use_id, block.content);
    if (chart && !existingChartIds.has(chart.id ?? "")) {
      content.push(chart);
      if (chart.id) existingChartIds.add(chart.id);
    }
    const document = documentFromContent(block.content);
    if (document && !existingDocumentIds.has(document.id ?? "")) {
      content.push(document);
      if (document.id) existingDocumentIds.add(document.id);
    }
  }
  return content.length === event.content.length
    ? event
    : { ...event, content };
}
