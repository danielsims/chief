import { useMemo } from "react";

import { LineChartCard } from "../charts/line-chart-card";

const RANGE_CONFIG = {
  "7d": { label: "7D", days: 7, bucket: 1 },
  "14d": { label: "14D", days: 14, bucket: 1 },
  "30d": { label: "30D", days: 30, bucket: 1 },
  "3m": { label: "3M", days: 90, bucket: 7 },
  "1y": { label: "1Y", days: 365, bucket: 30 },
} as const;

function rangeConfig(rangeKey: string) {
  if (rangeKey === "7d") return RANGE_CONFIG["7d"];
  if (rangeKey === "14d") return RANGE_CONFIG["14d"];
  if (rangeKey === "3m") return RANGE_CONFIG["3m"];
  if (rangeKey === "1y") return RANGE_CONFIG["1y"];
  return RANGE_CONFIG["30d"];
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function parseDate(raw: string) {
  const digits = raw.replace(/-/g, "");
  if (digits.length !== 8) return null;
  const date = new Date(
    Date.UTC(
      Number(digits.slice(0, 4)),
      Number(digits.slice(4, 6)) - 1,
      Number(digits.slice(6, 8)),
    ),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

export function shortAnalyticsDate(raw: string) {
  const date = parseDate(raw);
  return date ? `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}` : raw;
}

function buildSeries(
  source: { date: string; value: number }[],
  days: number,
  bucketSize: number,
) {
  const values = new Map(
    source.map((point) => [point.date.replace(/-/g, ""), point.value]),
  );
  const latest = source
    .map((point) => parseDate(point.date))
    .filter((date): date is Date => Boolean(date))
    .reduce<Date | null>(
      (maximum, date) => (!maximum || date > maximum ? date : maximum),
      null,
    );
  if (!latest) return [];

  const daily = Array.from({ length: days }, (_, index) => {
    const date = new Date(latest);
    date.setUTCDate(date.getUTCDate() - (days - index - 1));
    const key = dateKey(date);
    return { date: key, value: values.get(key) ?? 0 };
  });
  if (bucketSize === 1) return daily;

  const buckets: { date: string; value: number }[] = [];
  for (let index = 0; index < daily.length; index += bucketSize) {
    const slice = daily.slice(index, index + bucketSize);
    const finalPoint = slice.at(-1);
    if (!finalPoint) continue;
    buckets.push({
      date: finalPoint.date,
      value: Math.round(
        slice.reduce((sum, point) => sum + point.value, 0) / slice.length,
      ),
    });
  }
  return buckets;
}

export function ConnectionPreview({
  name,
  metricLabel = "Active users",
  title,
  series,
  rangeKey,
}: {
  name: string;
  metricLabel?: string;
  title?: string;
  series: { date: string; value: number }[];
  rangeKey: string;
}) {
  const range = rangeConfig(rangeKey);
  const points = useMemo(
    () => buildSeries(series, range.days, range.bucket),
    [range.bucket, range.days, series],
  );

  return (
    <LineChartCard
      title={title ?? metricLabel}
      subtitle={name}
      contextLabel={`${range.label}${range.bucket > 1 ? " · daily average" : ""}`}
      formatX={shortAnalyticsDate}
      series={[
        {
          id: `${name}-${metricLabel}`,
          label: metricLabel,
          points: points.map((point) => ({
            x: point.date,
            value: point.value,
          })),
        },
      ]}
    />
  );
}
