import type { BaseComponentProps } from "@json-render/react";
import type { ReactNode } from "react";
import { useStateBinding } from "@json-render/react";
import { z } from "zod";

import type { PageComponentName } from "@chief/relay-contracts";
import {
  databaseColors,
  jsonValueSchema,
  parseJsonNumber,
  parseJsonString,
} from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import { cn } from "@chief/ui/lib/utils";

import { StreamingMarkdown } from "../chat/streaming-markdown";
import { ColorDot } from "../databases/database-cells";
import { insetCardClass } from "../inset-card";

// Props reach these components resolved: bindings are already values. They
// are still read through parsers, since a binding can resolve to anything.
const rowsSchema = z.array(z.record(z.string(), jsonValueSchema));
const columnsSchema = z.array(z.object({ key: z.string(), label: z.string() }));
const optionsSchema = z.array(z.string());
const colorSchema = z.enum(databaseColors);

type Props = BaseComponentProps["props"];

const text = (props: Props, key: string) => parseJsonString(props[key]) ?? "";

/** A value shown as text: strings as they are, numbers formatted. */
function display(value: z.infer<typeof jsonValueSchema> | undefined) {
  const number = parseJsonNumber(value);
  if (number !== undefined) return number.toLocaleString();
  return parseJsonString(value) ?? (value === true ? "Yes" : "");
}

/** Only web links open; anything else shows as plain text. */
function webLink(href: string) {
  const url = URL.parse(href);
  return url?.protocol === "https:" || url?.protocol === "http:"
    ? url.href
    : undefined;
}

const gapClass = { sm: "gap-2", md: "gap-4", lg: "gap-6" } as const;
const gapSchema = z.enum(["sm", "md", "lg"]);

/**
 * How each page component looks: Chief's own type, spacing and cards, so a
 * page reads as part of the app.
 */
export const pageComponentViews: Record<
  PageComponentName,
  (context: BaseComponentProps) => ReactNode
> = {
  Stack: ({ props, children }) => (
    <div
      className={cn(
        "flex min-w-0",
        props.direction === "horizontal"
          ? "flex-row flex-wrap items-center"
          : "flex-col",
        gapClass[gapSchema.catch("md").parse(props.gap)],
        props.align === "center" && "items-center",
        props.align === "end" && "items-end",
        props.align === "start" && "items-start",
      )}
    >
      {children}
    </div>
  ),
  Grid: ({ props, children }) => (
    <div
      className="grid gap-3"
      style={{
        gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, parseJsonNumber(props.columns) ?? 2))}, minmax(0, 1fr))`,
      }}
    >
      {children}
    </div>
  ),
  Card: ({ props, children }) => (
    <section className={cn(insetCardClass, "min-w-0 px-4 py-3.5")}>
      {text(props, "title") ? (
        <h3 className="text-[13px] font-medium tracking-[-0.01em]">
          {text(props, "title")}
        </h3>
      ) : null}
      {text(props, "description") ? (
        <p className="text-muted-foreground mt-0.5 text-[12px] leading-5">
          {text(props, "description")}
        </p>
      ) : null}
      {children ? (
        <div className="mt-3 flex flex-col gap-3">{children}</div>
      ) : null}
    </section>
  ),
  Heading: ({ props }) => {
    const level = props.level === "1" ? 1 : props.level === "3" ? 3 : 2;
    const Tag = level === 1 ? "h1" : level === 3 ? "h3" : "h2";
    return (
      <Tag
        className={cn(
          "font-medium tracking-[-0.015em]",
          level === 1 && "text-[22px] leading-8",
          level === 2 && "text-[16px] leading-6",
          level === 3 && "text-[13px] leading-5",
        )}
      >
        {text(props, "text")}
      </Tag>
    );
  },
  Text: ({ props }) => (
    <p
      className={cn(
        "text-[13px] leading-5",
        props.tone === "muted" && "text-muted-foreground",
      )}
    >
      {text(props, "text")}
    </p>
  ),
  Markdown: ({ props }) => (
    <div className="text-[13px] leading-6">
      <StreamingMarkdown>{text(props, "text")}</StreamingMarkdown>
    </div>
  ),
  Metric: ({ props }) => (
    <div className={cn(insetCardClass, "min-w-0 px-4 py-3")}>
      <p className="text-muted-foreground truncate text-[12px]">
        {text(props, "label")}
      </p>
      <p className="mt-1 truncate text-[22px] leading-7 font-medium tracking-[-0.02em] tabular-nums">
        {display(
          jsonValueSchema.optional().catch(undefined).parse(props.value),
        )}
      </p>
      {text(props, "hint") ? (
        <p className="text-muted-foreground mt-0.5 truncate text-[11px]">
          {text(props, "hint")}
        </p>
      ) : null}
    </div>
  ),
  Badge: ({ props }) => (
    <span className="bg-foreground/[0.05] inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]">
      <ColorDot color={colorSchema.catch("gray").parse(props.color)} />
      {text(props, "text")}
    </span>
  ),
  Progress: ({ props }) => {
    const value =
      Number(parseJsonNumber(props.value) ?? parseJsonString(props.value)) || 0;
    const max =
      Number(parseJsonNumber(props.max) ?? parseJsonString(props.max)) || 100;
    const share = Math.min(100, Math.max(0, (value / max) * 100));
    return (
      <div className="flex flex-col gap-1.5">
        {text(props, "label") ? (
          <div className="text-muted-foreground flex justify-between text-[12px]">
            <span>{text(props, "label")}</span>
            <span className="tabular-nums">{Math.round(share)}%</span>
          </div>
        ) : null}
        <div className="bg-foreground/[0.07] h-1.5 overflow-hidden rounded-full">
          <div
            className="bg-foreground h-full rounded-full transition-[width]"
            style={{ width: `${share}%` }}
          />
        </div>
      </div>
    );
  },
  Table: ({ props }) => {
    const rows = rowsSchema.catch([]).parse(props.rows);
    const columns = columnsSchema.catch([]).parse(props.columns);
    if (!rows.length)
      return (
        <p className="text-muted-foreground py-3 text-[13px]">
          {text(props, "empty") || "Nothing yet."}
        </p>
      );
    return (
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-foreground/[0.07] border-b">
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="text-muted-foreground h-8 px-2 text-[12px] font-normal"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={parseJsonString(row.id) ?? index}
                className="border-foreground/[0.05] border-b last:border-b-0"
              >
                {columns.map((column) => (
                  <td key={column.key} className="h-9 max-w-64 truncate px-2">
                    {display(row[column.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  },
  BarChart: ({ props }) => {
    const rows = rowsSchema.catch([]).parse(props.rows);
    const labelKey = text(props, "label");
    const valueKey = text(props, "value");
    const bars = rows.map((row) => ({
      label: display(row[labelKey]),
      value: parseJsonNumber(row[valueKey]) ?? 0,
    }));
    const largest = Math.max(1, ...bars.map((bar) => bar.value));
    return (
      <figure className="flex flex-col gap-2">
        {text(props, "title") ? (
          <figcaption className="text-muted-foreground text-[12px]">
            {text(props, "title")}
          </figcaption>
        ) : null}
        {bars.map((bar, index) => (
          <div
            key={`${bar.label}:${index}`}
            className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-3 text-[12px]"
          >
            <span className="truncate">{bar.label}</span>
            <span className="bg-foreground/[0.05] h-2 overflow-hidden rounded-full">
              <span
                className="bg-foreground/70 block h-full rounded-full"
                style={{ width: `${(bar.value / largest) * 100}%` }}
              />
            </span>
            <span className="text-muted-foreground tabular-nums">
              {bar.value.toLocaleString()}
            </span>
          </div>
        ))}
      </figure>
    );
  },
  Button: ({ props, emit }) => (
    <Button
      size="sm"
      className="w-fit"
      variant={
        props.variant === "secondary"
          ? "outline"
          : props.variant === "ghost"
            ? "ghost"
            : "default"
      }
      onClick={() => emit("press")}
    >
      {text(props, "label")}
    </Button>
  ),
  TextInput: ({ props, bindings, emit }) => (
    <BoundField label={text(props, "label")}>
      <BoundInput
        path={bindings?.value}
        placeholder={text(props, "placeholder")}
        onChange={() => emit("change")}
      />
    </BoundField>
  ),
  Select: ({ props, bindings, emit }) => (
    <BoundField label={text(props, "label")}>
      <BoundSelect
        path={bindings?.value}
        options={optionsSchema.catch([]).parse(props.options)}
        onChange={() => emit("change")}
      />
    </BoundField>
  ),
  Link: ({ props }) => {
    const href = webLink(text(props, "href"));
    return href ? (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="w-fit text-[13px] text-sky-600 hover:underline dark:text-sky-400"
      >
        {text(props, "label")}
      </a>
    ) : (
      <span className="text-[13px]">{text(props, "label")}</span>
    );
  },
  Divider: () => <hr className="border-foreground/[0.07]" />,
};

function BoundField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      {label ? (
        <span className="text-muted-foreground text-[12px]">{label}</span>
      ) : null}
      {children}
    </label>
  );
}

const fieldClass =
  "bg-background h-8 w-full min-w-0 rounded-lg px-2.5 text-[13px] outline-none shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent)] focus:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_22%,transparent)]";

function BoundInput({
  path,
  placeholder,
  onChange,
}: {
  path?: string;
  placeholder: string;
  onChange: () => void;
}) {
  const [value, setValue] = useStateBinding<string>(path ?? "/__unbound");
  return (
    <input
      className={fieldClass}
      value={parseJsonString(value) ?? ""}
      placeholder={placeholder}
      maxLength={2_000}
      onChange={(event) => {
        setValue(event.target.value);
        onChange();
      }}
    />
  );
}

function BoundSelect({
  path,
  options,
  onChange,
}: {
  path?: string;
  options: string[];
  onChange: () => void;
}) {
  const [value, setValue] = useStateBinding<string>(path ?? "/__unbound");
  return (
    <select
      className={fieldClass}
      value={parseJsonString(value) ?? ""}
      onChange={(event) => {
        setValue(event.target.value);
        onChange();
      }}
    >
      <option value="" disabled>
        Choose…
      </option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
