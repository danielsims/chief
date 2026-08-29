import type { JsonObject, JsonValue } from "@chief/relay-contracts";
import {
  isJsonNumber,
  isJsonString,
  parseJsonObject,
  parseJsonValue,
} from "@chief/relay-contracts";

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
  rows: JsonObject[];
  range?: { startDate?: string; endDate?: string };
  source?: { provider?: string };
}

function toolResultText(content: JsonValue | undefined): string {
  if (isJsonString(content)) return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const record = parseJsonObject(part);
        return record && isJsonString(record.text) ? record.text : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return parseJsonObject(content) ? JSON.stringify(content) : "";
}

/** Parses JSON that may sit after a prose prefix ("[log] Chart result: {…}"). */
function looseJsonParse(text: string): JsonValue | undefined {
  for (const start of [text.indexOf("{"), text.indexOf("[")]) {
    if (start < 0) continue;
    try {
      const parsed: unknown = JSON.parse(text.slice(start));
      const value = parseJsonValue(parsed);
      if (value !== undefined) return value;
    } catch {
      // The other start may still be real JSON (e.g. "[log] {…}").
    }
  }
  return undefined;
}

function parseJsonCandidates(text: string): JsonValue[] {
  const candidates = new Set<string>();
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    candidates.add(trimmed);
  }
  for (const line of text.split("\n")) {
    const log = /^\s*\[log\]\s+(.+)\s*$/.exec(line)?.[1];
    if (log) candidates.add(log);
  }

  const parsed: JsonValue[] = [];
  for (const candidate of candidates) {
    try {
      const raw: unknown = JSON.parse(candidate);
      const value = parseJsonValue(raw);
      if (value !== undefined) parsed.push(value);
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
    const record = parseJsonObject(item);
    if (!record || !Array.isArray(record.logs)) continue;
    for (const log of record.logs) {
      if (!isJsonString(log)) continue;
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
  value: JsonValue,
  key = "series",
  reports: { key: string; data: ReportData }[] = [],
) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectReports(item, `${key} ${index + 1}`, reports),
    );
    return reports;
  }
  const record = parseJsonObject(value);
  if (!record) return reports;

  const report = parseReport(record);
  if (report) {
    reports.push({ key, data: report });
    return reports;
  }

  for (const [childKey, child] of Object.entries(record)) {
    collectReports(child, childKey === "data" ? key : childKey, reports);
  }
  return reports;
}

function parseReport(value: JsonObject): ReportData | undefined {
  if (!Array.isArray(value.columns) || !Array.isArray(value.rows)) {
    return undefined;
  }
  const columns = value.columns.flatMap((candidate) => {
    const column = parseJsonObject(candidate);
    if (!column) return [];
    return [
      {
        kind: isJsonString(column.kind) ? column.kind : undefined,
        name: isJsonString(column.name) ? column.name : undefined,
      },
    ];
  });
  const rows = value.rows.flatMap((candidate) => {
    const row = parseJsonObject(candidate);
    return row ? [row] : [];
  });
  if (
    columns.length !== value.columns.length ||
    rows.length !== value.rows.length
  ) {
    return undefined;
  }
  const range = parseJsonObject(value.range);
  const source = parseJsonObject(value.source);
  return {
    columns,
    rows,
    range: range
      ? {
          startDate: isJsonString(range.startDate)
            ? range.startDate
            : undefined,
          endDate: isJsonString(range.endDate) ? range.endDate : undefined,
        }
      : undefined,
    source: source
      ? {
          provider: isJsonString(source.provider) ? source.provider : undefined,
        }
      : undefined,
  };
}

function explicitChart(value: JsonValue): GenerativeChartData | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const chart = explicitChart(item);
      if (chart) return chart;
    }
    return null;
  }
  const record = parseJsonObject(value);
  if (!record) return null;
  const data = parseJsonObject(record.data);
  if (
    record.type === "data-chart" &&
    data?.kind === "line" &&
    isJsonString(data.title) &&
    isJsonString(data.yLabel) &&
    Array.isArray(data.series)
  ) {
    const series = data.series.flatMap((candidate, index) => {
      const seriesRecord = parseJsonObject(candidate);
      if (!seriesRecord || !Array.isArray(seriesRecord.points)) return [];
      const points = seriesRecord.points.flatMap((candidatePoint) => {
        const point = parseJsonObject(candidatePoint);
        return point &&
          isJsonString(point.x) &&
          isJsonNumber(point.value) &&
          Number.isFinite(point.value)
          ? [{ x: point.x, value: point.value }]
          : [];
      });
      if (points.length < 2) return [];
      return [
        {
          id: isJsonString(seriesRecord.id)
            ? seriesRecord.id
            : `series-${index + 1}`,
          label: isJsonString(seriesRecord.label)
            ? seriesRecord.label
            : `Series ${index + 1}`,
          points,
        },
      ];
    });
    if (series.length === 0) return null;
    return {
      kind: "line",
      title: data.title,
      subtitle: isJsonString(data.subtitle) ? data.subtitle : undefined,
      xLabel: isJsonString(data.xLabel) ? data.xLabel : undefined,
      yLabel: data.yLabel,
      series,
    };
  }
  for (const child of Object.values(record)) {
    const chart = explicitChart(child);
    if (chart) return chart;
  }
  return null;
}

function chartFromContent(
  toolUseId: string,
  content: JsonValue | undefined,
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
      return (isJsonString(x) || isJsonNumber(x)) &&
        isJsonNumber(value) &&
        Number.isFinite(value)
        ? [{ x: String(x), value }]
        : [];
    });
    if (points.length < 2) return [];
    return [{ key, data, dimension, metric, points }];
  });
  if (chartable.length === 0) return null;

  const [firstReport] = chartable;
  if (!firstReport) return null;
  const metric = firstReport.metric;
  const dimension = firstReport.dimension;
  const provider = firstReport.data.source?.provider;
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

function documentFromContent(
  content: JsonValue | undefined,
): GenerativeDocumentBlock | null {
  const visit = (value: JsonValue): GenerativeDocumentBlock | null => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
      return null;
    }
    const record = parseJsonObject(value);
    if (!record) return null;
    const file = parseJsonObject(record.file) ?? record;
    if (
      isJsonString(file.id) &&
      isJsonString(file.name) &&
      isJsonString(file.path) &&
      isJsonString(file.currentVersionId) &&
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
    for (const child of Object.values(record)) {
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
