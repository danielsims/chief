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

/** "2026-06-26" or "20260626" to "Jun 26". */
function formatDate(raw: string): string {
  const digits = raw.replace(/-/g, "");
  if (digits.length !== 8) return raw;
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (!month || month > 12 || !day) return raw;
  return `${MONTHS[month - 1]} ${day}`;
}

/**
 * The first live data moment: a small daily bar chart from the series the
 * setup agent verified, shown the instant an integration connects. Single
 * series, so the header names it; per-bar hover shows date and value.
 */
export function ConnectionPreview({
  name,
  metricLabel,
  series,
}: {
  name: string;
  metricLabel?: string;
  series: Array<{ date: string; value: number }>;
}) {
  if (series.length === 0) return null;
  const max = Math.max(...series.map((point) => point.value), 1);
  const total = series.reduce((sum, point) => sum + point.value, 0);

  return (
    <div className="border bg-background p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">Live from {name}</p>
        <p className="text-xs text-muted-foreground">
          {metricLabel ?? "Active users"}, last {series.length} days
        </p>
      </div>
      <p className="mt-1 font-serif text-3xl">{total.toLocaleString()}</p>
      <div className="mt-5 flex h-24 items-end gap-[3px] border-b pb-px">
        {series.map((point) => (
          <div key={point.date} className="group relative min-w-0 flex-1">
            <div
              className="w-full bg-foreground/75 transition-colors group-hover:bg-foreground"
              style={{
                height: `${Math.max((point.value / max) * 96, 2)}px`,
              }}
            />
            <div className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap border bg-background px-1.5 py-0.5 text-[10px] text-foreground group-hover:block">
              {formatDate(point.date)} · {point.value.toLocaleString()}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
        <span>{formatDate(series[0]!.date)}</span>
        <span>{formatDate(series[series.length - 1]!.date)}</span>
      </div>
    </div>
  );
}
