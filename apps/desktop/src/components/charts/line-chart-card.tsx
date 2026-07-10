import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { GenerativeChartSeries } from "@marketer/agent-runtime/types";
import { cn } from "@marketer/ui/lib/utils";

const SERIES_STYLES = [
  { path: "stroke-foreground", dot: "fill-foreground" },
  { path: "stroke-muted-foreground", dot: "fill-muted-foreground" },
  { path: "stroke-emerald-500", dot: "fill-emerald-500" },
  { path: "stroke-blue-500", dot: "fill-blue-500" },
] as const;

function niceMaximum(value: number) {
  if (value <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function linePath(points: Array<{ x: number; y: number }>) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
}

export function LineChartCard({
  title,
  subtitle,
  contextLabel,
  series,
  formatX = (value) => value,
}: {
  title: string;
  subtitle?: string;
  contextLabel?: string;
  series: GenerativeChartSeries[];
  formatX?: (value: string) => string;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const clipId = useId().replace(/:/g, "");
  const [width, setWidth] = useState(760);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const update = () => setWidth(Math.max(element.clientWidth, 360));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const primary = series[0]?.points ?? [];
  const pointCount = Math.max(...series.map((item) => item.points.length), 0);
  const height = 260;
  const left = 48;
  const right = 16;
  const top = 14;
  const bottom = 34;
  const axisBottom = height - bottom;
  const dataLeft = left + 5;
  const dataRight = width - right - 5;
  const dataTop = top + 7;
  const dataBottom = axisBottom - 7;
  const plotWidth = Math.max(dataRight - dataLeft, 1);
  const plotHeight = Math.max(dataBottom - dataTop, 1);
  const maximum = niceMaximum(
    Math.max(
      ...series.flatMap((item) => item.points.map((point) => point.value)),
      1,
    ),
  );

  const coordinates = useMemo(
    () =>
      series.map((item) =>
        item.points.map((point, index) => ({
          ...point,
          x:
            dataLeft +
            (index / Math.max(item.points.length - 1, 1)) * plotWidth,
          y: dataBottom - (point.value / maximum) * plotHeight,
        })),
      ),
    [dataBottom, dataLeft, maximum, plotHeight, plotWidth, series],
  );
  const yTicks = [maximum, maximum / 2, 0];
  const xTickIndexes = Array.from(
    new Set([0, Math.floor((primary.length - 1) / 2), primary.length - 1]),
  ).filter((index) => index >= 0);
  const hoveredX =
    hoveredIndex === null ? null : coordinates[0]?.[hoveredIndex]?.x;
  const hoveredTop =
    hoveredIndex === null
      ? null
      : Math.min(
          ...coordinates.flatMap((item) =>
            item[hoveredIndex] ? [item[hoveredIndex]!.y] : [],
          ),
        );

  if (pointCount < 2) return null;

  return (
    <div className="border bg-card">
      <div className="flex min-h-[66px] items-start justify-between gap-4 px-5 pt-5">
        <div>
          <p className="text-sm font-medium">{title}</p>
          {subtitle ? (
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {contextLabel ? (
          <p className="text-xs text-muted-foreground">{contextLabel}</p>
        ) : null}
      </div>

      {series.length > 1 ? (
        <div className="flex min-h-7 flex-wrap gap-x-4 gap-y-1 px-5 pt-2">
          {series.map((item, index) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground"
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  SERIES_STYLES[index % SERIES_STYLES.length]!.dot,
                )}
              />
              {item.label}
            </span>
          ))}
        </div>
      ) : null}

      <div
        ref={chartRef}
        className="relative mt-2 h-64 w-full overflow-visible"
        onMouseLeave={() => setHoveredIndex(null)}
      >
        <svg
          ref={svgRef}
          aria-label={`${title} line chart`}
          className="h-64 w-full"
          role="img"
          viewBox={`0 0 ${width} ${height}`}
          onMouseMove={(event) => {
            const bounds = svgRef.current?.getBoundingClientRect();
            if (!bounds || primary.length === 0) return;
            const viewX =
              ((event.clientX - bounds.left) / bounds.width) * width;
            const ratio = Math.min(
              1,
              Math.max(0, (viewX - dataLeft) / plotWidth),
            );
            setHoveredIndex(Math.round(ratio * (primary.length - 1)));
          }}
        >
          <defs>
            <clipPath id={clipId}>
              <rect
                x={dataLeft}
                y={dataTop}
                width={plotWidth}
                height={plotHeight}
              />
            </clipPath>
          </defs>

          {yTicks.map((tick) => {
            const y = dataBottom - (tick / maximum) * plotHeight;
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
                  x={left - 9}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px]"
                >
                  {Math.round(tick).toLocaleString()}
                </text>
              </g>
            );
          })}

          <g clipPath={`url(#${clipId})`}>
            {coordinates.map((item, index) => (
              <path
                key={series[index]!.id}
                d={linePath(item)}
                fill="none"
                className={SERIES_STYLES[index % SERIES_STYLES.length]!.path}
                strokeDasharray={index === 1 ? "5 5" : undefined}
                strokeLinecap="square"
                strokeLinejoin="miter"
                strokeWidth="1.75"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {hoveredIndex !== null
              ? coordinates.map((item, index) => {
                  const point = item[hoveredIndex];
                  return point ? (
                    <circle
                      key={`${series[index]!.id}-point`}
                      cx={point.x}
                      cy={point.y}
                      r="3.5"
                      className={
                        SERIES_STYLES[index % SERIES_STYLES.length]!.dot
                      }
                    />
                  ) : null;
                })
              : null}
          </g>

          {/* Axes are deliberately outside the data inset and drawn last, so
              a zero or edge value can never obscure them. */}
          <line
            x1={left}
            x2={left}
            y1={top}
            y2={axisBottom}
            className="stroke-border"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={left}
            x2={width - right}
            y1={axisBottom}
            y2={axisBottom}
            className="stroke-border"
            vectorEffect="non-scaling-stroke"
          />
          {hoveredX !== null ? (
            <line
              x1={hoveredX}
              x2={hoveredX}
              y1={dataTop}
              y2={dataBottom}
              className="stroke-muted-foreground/40"
              strokeDasharray="2 4"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {xTickIndexes.map((index) => {
            const x = coordinates[0]?.[index]?.x;
            const point = primary[index];
            return x !== undefined && point ? (
              <text
                key={`${point.x}-${index}`}
                x={x}
                y={height - 8}
                textAnchor={
                  index === 0
                    ? "start"
                    : index === primary.length - 1
                      ? "end"
                      : "middle"
                }
                className="fill-muted-foreground text-[10px]"
              >
                {formatX(point.x)}
              </text>
            ) : null;
          })}
        </svg>

        {hoveredIndex !== null &&
        hoveredX !== null &&
        Number.isFinite(hoveredTop) ? (
          <div
            className="pointer-events-none absolute z-20 min-w-48 border bg-background px-3 py-2 shadow-lg"
            style={{
              left: `${(hoveredX / width) * 100}%`,
              top: `${((hoveredTop ?? dataTop) / height) * 100}%`,
              transform: `translate(${hoveredX > width * 0.72 ? "-100%" : hoveredX < width * 0.28 ? "0" : "-50%"}, calc(-100% - 10px))`,
            }}
          >
            <p className="text-[11px] text-muted-foreground">
              {formatX(primary[hoveredIndex]?.x ?? "")}
            </p>
            <div className="mt-1.5 space-y-1">
              {series.map((item) => {
                const point = item.points[hoveredIndex];
                return point ? (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-5 text-xs"
                  >
                    <span className="max-w-44 truncate text-muted-foreground">
                      {item.label}
                    </span>
                    <span className="font-medium">
                      {point.value.toLocaleString()}
                    </span>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
