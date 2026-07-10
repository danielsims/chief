import { useMemo, useState } from "react";
import { cn } from "@marketer/ui/lib/utils";

const RANGE_CONFIG = {
  "7d": { label: "7D", days: 7, bucket: 1 },
  "14d": { label: "14D", days: 14, bucket: 1 },
  "30d": { label: "30D", days: 30, bucket: 1 },
  "3m": { label: "3M", days: 90, bucket: 7 },
  "1y": { label: "1Y", days: 365, bucket: 30 },
} as const;

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

function shortDate(raw: string) {
  const date = parseDate(raw);
  return date ? `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}` : raw;
}

function fullDate(raw: string) {
  const date = parseDate(raw);
  return date
    ? date.toLocaleDateString(undefined, {
        timeZone: "UTC",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : raw;
}

function buildSeries(
  source: Array<{ date: string; value: number }>,
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

  const buckets: Array<{ date: string; value: number }> = [];
  for (let index = 0; index < daily.length; index += bucketSize) {
    const slice = daily.slice(index, index + bucketSize);
    buckets.push({
      date: slice.at(-1)!.date,
      value: Math.round(
        slice.reduce((sum, point) => sum + point.value, 0) / slice.length,
      ),
    });
  }
  return buckets;
}

function niceMaximum(value: number) {
  if (value <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function smoothPath(
  points: Array<{ x: number; y: number }>,
  minimumY: number,
  maximumY: number,
) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0]!.x},${points[0]!.y}`;
  const clampY = (value: number) =>
    Math.min(maximumY, Math.max(minimumY, value));
  let path = `M${points[0]!.x},${points[0]!.y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const after = points[index + 2] ?? next;
    const controlOneX = current.x + (next.x - previous.x) / 6;
    const controlOneY = clampY(current.y + (next.y - previous.y) / 6);
    const controlTwoX = next.x - (after.x - current.x) / 6;
    const controlTwoY = clampY(next.y - (after.y - current.y) / 6);
    path += ` C${controlOneX},${controlOneY} ${controlTwoX},${controlTwoY} ${next.x},${next.y}`;
  }
  return path;
}

export function ConnectionPreview({
  name,
  metricLabel = "Active users",
  title,
  series,
  rangeKey,
  visualization = "line",
}: {
  name: string;
  metricLabel?: string;
  title?: string;
  series: Array<{ date: string; value: number }>;
  rangeKey: string;
  visualization?: "line" | "bar";
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const range =
    RANGE_CONFIG[rangeKey as keyof typeof RANGE_CONFIG] ?? RANGE_CONFIG["30d"];
  const points = useMemo(
    () => buildSeries(series, range.days, range.bucket),
    [range.bucket, range.days, series],
  );
  if (points.length === 0) return null;

  const width = 960;
  const height = 260;
  const left = 0;
  const right = 0;
  const top = 16;
  const bottom = 32;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maximum = niceMaximum(
    Math.max(...points.map((point) => point.value), 1),
  );
  const coordinates = points.map((point, index) => ({
    ...point,
    x: left + (index / Math.max(points.length - 1, 1)) * plotWidth,
    y: top + plotHeight - (point.value / maximum) * plotHeight,
  }));
  const line = smoothPath(coordinates, top, top + plotHeight);
  const hovered =
    hoveredIndex === null ? null : (coordinates[hoveredIndex] ?? null);
  const previous =
    hoveredIndex !== null && hoveredIndex > 0
      ? coordinates[hoveredIndex - 1]
      : null;
  const change =
    hovered && previous?.value
      ? ((hovered.value - previous.value) / previous.value) * 100
      : null;
  const yTicks = [maximum, maximum / 2, 0];
  const xTickIndexes = [
    0,
    Math.floor((points.length - 1) / 2),
    points.length - 1,
  ];

  return (
    <div className="border bg-card">
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <div>
          <p className="text-sm font-medium">{title ?? metricLabel}</p>
          <p className="mt-1 text-xs text-muted-foreground">{name}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {range.label}
          {range.bucket > 1 ? " · daily average" : ""}
        </p>
      </div>

      <div className="relative mt-4" onMouseLeave={() => setHoveredIndex(null)}>
        <svg
          aria-label={`${metricLabel} over ${range.label}`}
          className="h-64 w-full overflow-visible"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          {yTicks.map((tick) => {
            const y = top + plotHeight - (tick / maximum) * plotHeight;
            return (
              <g key={tick}>
                <line
                  x1={left}
                  x2={width - right}
                  y1={y}
                  y2={y}
                  className="stroke-border"
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={8}
                  y={y + 4}
                  textAnchor="start"
                  className="fill-muted-foreground text-[10px]"
                >
                  {Math.round(tick).toLocaleString()}
                </text>
              </g>
            );
          })}
          {visualization === "line" ? (
            <path
              d={line}
              fill="none"
              className="stroke-foreground"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.75"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {visualization === "bar"
            ? coordinates.map((point) => {
                const slot = plotWidth / Math.max(coordinates.length, 1);
                const barWidth = Math.min(slot * 0.62, 32);
                return (
                  <rect
                    key={`bar-${point.date}`}
                    x={point.x - barWidth / 2}
                    y={point.y}
                    width={barWidth}
                    height={top + plotHeight - point.y}
                    className="fill-foreground/70"
                  />
                );
              })
            : null}
          {coordinates.map((point, index) => (
            <g key={point.date}>
              <circle
                cx={point.x}
                cy={point.y}
                r={hoveredIndex === index ? 4 : 2.5}
                className={cn(
                  "fill-card stroke-foreground",
                  hoveredIndex !== index && "opacity-0",
                )}
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={point.x}
                cy={point.y}
                r="12"
                fill="transparent"
                onMouseEnter={() => setHoveredIndex(index)}
              />
            </g>
          ))}
          {xTickIndexes.map((index) => {
            const point = coordinates[index]!;
            return (
              <text
                key={`${point.date}-${index}`}
                x={
                  index === 0
                    ? 8
                    : index === points.length - 1
                      ? width - 8
                      : point.x
                }
                y={height - 7}
                textAnchor={
                  index === 0
                    ? "start"
                    : index === points.length - 1
                      ? "end"
                      : "middle"
                }
                className="fill-muted-foreground text-[10px]"
              >
                {shortDate(point.date)}
              </text>
            );
          })}
        </svg>

        {hovered ? (
          <div
            className="pointer-events-none absolute z-20 min-w-44 border bg-background px-3 py-2 shadow-lg"
            style={{
              left: `${(hovered.x / width) * 100}%`,
              top: `${(hovered.y / height) * 100}%`,
              transform: `translate(${hovered.x > width * 0.75 ? "-100%" : hovered.x < width * 0.25 ? "0" : "-50%"}, calc(-100% - 12px))`,
            }}
          >
            <p className="text-[11px] text-muted-foreground">
              {fullDate(hovered.date)}
            </p>
            <div className="mt-1 flex items-baseline justify-between gap-4">
              <span className="text-xs">{metricLabel}</span>
              <span className="text-sm font-medium">
                {hovered.value.toLocaleString()}
              </span>
            </div>
            {change !== null ? (
              <p
                className={cn(
                  "mt-1 text-[10px]",
                  change > 0
                    ? "text-emerald-500"
                    : change < 0
                      ? "text-red-500"
                      : "text-muted-foreground",
                )}
              >
                {change > 0 ? "+" : ""}
                {change.toFixed(0)}% vs previous point
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
