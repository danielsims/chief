import { createContext, useContext, useRef, useState } from "react";
import { Braces } from "lucide-react";
import { z } from "zod";

import type {
  AutomationStep,
  JsonObject,
  JsonValue,
} from "@chief/relay-contracts";
import {
  isJsonObject,
  isJsonString,
  jsonValueSchema,
  parseJsonString,
} from "@chief/relay-contracts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@chief/ui/components/dropdown-menu";
import { SelectItem } from "@chief/ui/components/select";
import { Switch } from "@chief/ui/components/switch";
import { cn } from "@chief/ui/lib/utils";

import { referenceFor } from "./automation-draft";
import { Choice, controlClass, Field, textAreaClass } from "./automation-panel";

/** The latest event sent to the webhook, so Insert can offer its real fields. */
export const TriggerEventContext = createContext<JsonObject | null>(null);

const referenceSegment = /^[A-Za-z0-9_-]{1,64}$/u;

/** An event's leaf fields as reference paths, each with a short sample. */
function eventFields(event: JsonObject) {
  const fields: { path: string; sample: string }[] = [];
  const visit = (value: JsonValue, path: string, depth: number) => {
    if (fields.length >= 30) return;
    const children = Array.isArray(value)
      ? value.slice(0, 1).map((item, index) => [String(index), item] as const)
      : isJsonObject(value)
        ? Object.entries(value)
        : null;
    if (!children || depth === 8) {
      fields.push({
        path,
        sample: (parseJsonString(value) ?? JSON.stringify(value)).slice(0, 60),
      });
      return;
    }
    for (const [key, child] of children)
      if (referenceSegment.test(key)) visit(child, `${path}.${key}`, depth + 1);
  };
  visit(event, "", 0);
  return fields;
}

/** Offers the outputs this step may read and inserts the chosen reference. */
export function ReferenceMenu({
  outputs,
  onInsert,
  includeTrigger,
}: {
  outputs: readonly AutomationStep[];
  onInsert: (reference: string) => void;
  includeTrigger?: boolean;
}) {
  const event = useContext(TriggerEventContext);
  if (outputs.length === 0 && !includeTrigger) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Insert an earlier result"
          className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] -mr-1 flex h-5 items-center gap-1 rounded-[5px] px-1.5 text-[11px]"
        >
          <Braces size={11} />
          Insert
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-80 w-64 overflow-y-auto rounded-lg p-1"
      >
        <p className="text-muted-foreground px-2 py-1 text-[11px]">
          Use the result of
        </p>
        {outputs.map((step) => (
          <DropdownMenuItem
            key={step.id}
            className="flex-col items-start gap-0 rounded-md text-xs"
            onSelect={() =>
              onInsert(
                referenceFor(step, step.type === "condition" ? ".branch" : ""),
              )
            }
          >
            <span className="font-medium">{step.title}</span>
            <span className="text-muted-foreground font-mono text-[10px]">
              {referenceFor(step, step.type === "condition" ? ".branch" : "")}
            </span>
          </DropdownMenuItem>
        ))}
        {includeTrigger ? (
          <>
            <p className="text-muted-foreground px-2 pt-2 pb-1 text-[11px]">
              {event ? "The latest webhook event" : "The webhook event"}
            </p>
            {(event ? eventFields(event) : [{ path: "", sample: "" }]).map(
              (field) => (
                <DropdownMenuItem
                  key={field.path}
                  className="flex-col items-start gap-0 rounded-md text-xs"
                  onSelect={() => onInsert(`{{trigger.input${field.path}}}`)}
                >
                  <span className="w-full truncate font-mono text-[11px]">
                    {field.path.slice(1) || "Everything it sent"}
                  </span>
                  {field.sample ? (
                    <span className="text-muted-foreground w-full truncate text-[10px]">
                      {field.sample}
                    </span>
                  ) : null}
                </DropdownMenuItem>
              ),
            )}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function insertAt(
  element: HTMLInputElement | HTMLTextAreaElement | null,
  value: string,
  text: string,
) {
  const start = element?.selectionStart ?? value.length;
  const end = element?.selectionEnd ?? value.length;
  return value.slice(0, start) + text + value.slice(end);
}

/** A text box that can take references to earlier results. */
export function ReferenceText({
  value,
  onChange,
  outputs,
  includeTrigger,
  multiline,
  placeholder,
  label,
  hint,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  outputs: readonly AutomationStep[];
  includeTrigger?: boolean;
  multiline?: boolean;
  placeholder?: string;
  label: string;
  hint?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  return (
    <Field
      label={label}
      hint={hint}
      action={
        <ReferenceMenu
          outputs={outputs}
          includeTrigger={includeTrigger}
          onInsert={(reference) =>
            onChange(insertAt(ref.current, value, reference))
          }
        />
      }
    >
      {multiline ? (
        <textarea
          ref={ref}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={cn(textAreaClass, "min-h-20", className)}
        />
      ) : (
        <input
          ref={ref}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={cn(controlClass, className)}
        />
      )}
    </Field>
  );
}

/** The parts of a JSON schema property the form understands; the rest is ignored. */
const propertySchemaParser = z
  .object({
    type: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .catch(undefined),
    description: z.string().optional().catch(undefined),
    enum: z.array(jsonValueSchema).optional().catch(undefined),
    maxLength: z.number().optional().catch(undefined),
  })
  .catch({});

type PropertySchema = z.infer<typeof propertySchemaParser>;

function propertySchema(value: JsonValue | undefined): PropertySchema {
  return propertySchemaParser.parse(value ?? {});
}

function isType(schema: PropertySchema, type: string) {
  return Array.isArray(schema.type)
    ? schema.type.includes(type)
    : schema.type === type;
}

function JsonField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: JsonValue | undefined;
  onChange: (value: JsonValue | undefined) => void;
  hint?: string;
}) {
  const [text, setText] = useState(
    value === undefined ? "" : JSON.stringify(value, null, 2),
  );
  const [error, setError] = useState("");
  return (
    <Field label={label} hint={error || hint}>
      <textarea
        value={text}
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          if (!text.trim()) {
            setError("");
            onChange(undefined);
            return;
          }
          try {
            onChange(jsonValueSchema.parse(JSON.parse(text)));
            setError("");
          } catch {
            setError("This isn't valid JSON yet.");
          }
        }}
        className={cn(
          textAreaClass,
          "min-h-20 font-mono text-[11px]",
          error && "border-destructive",
        )}
      />
    </Field>
  );
}

const longTextNames =
  /^(content|body|text|message|markdown|prompt|instructions|description|summary|html)$/iu;

function humanise(name: string) {
  const words = name
    .replaceAll(/[_-]+/gu, " ")
    .replaceAll(/([a-z])([A-Z])/gu, "$1 $2")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A form for a tool's arguments, built from its JSON schema. */
export function ToolArguments({
  schema,
  value,
  onChange,
  outputs,
  includeTrigger,
}: {
  schema: JsonObject;
  value: JsonObject;
  onChange: (value: JsonObject) => void;
  outputs: readonly AutomationStep[];
  includeTrigger: boolean;
}) {
  const properties =
    isJsonObject(schema.properties) && !Array.isArray(schema.properties)
      ? schema.properties
      : {};
  const required = new Set(
    Array.isArray(schema.required) ? schema.required.filter(isJsonString) : [],
  );
  const names = Object.keys(properties);
  const requiredNames = names.filter((name) => required.has(name));
  const optionalNames = names.filter((name) => !required.has(name));
  // Optional inputs stay folded unless one is already filled in.
  const [showOptional, setShowOptional] = useState(() =>
    optionalNames.some((name) => value[name] !== undefined),
  );
  const set = (name: string, next: JsonValue | undefined) => {
    const copy = { ...value };
    if (next === undefined || next === "") delete copy[name];
    else copy[name] = next;
    onChange(copy);
  };
  if (names.length === 0)
    return (
      <p className="text-muted-foreground text-[11px] leading-4">
        This tool doesn't need any details.
      </p>
    );
  const field = (name: string) => {
    const property = propertySchema(properties[name]);
    const label = `${humanise(name)}${required.has(name) ? "" : " (optional)"}`;
    const current = value[name];
    if (property.enum?.every(isJsonString))
      return (
        <Field key={name} label={label} hint={property.description}>
          <Choice
            label={label}
            value={isJsonString(current) ? current : ""}
            onChange={(next) => set(name, next)}
          >
            {property.enum.map((option) => (
              <SelectItem key={String(option)} value={String(option)}>
                {String(option)}
              </SelectItem>
            ))}
          </Choice>
        </Field>
      );
    if (isType(property, "boolean"))
      return (
        <label key={name} className="flex items-start justify-between gap-4">
          <span>
            <span className="text-[12px]">{humanise(name)}</span>
            {property.description ? (
              <span
                title={property.description}
                className="text-muted-foreground mt-0.5 line-clamp-1 text-[11px] leading-4"
              >
                {property.description}
              </span>
            ) : null}
          </span>
          <Switch
            checked={current === true}
            onCheckedChange={(checked) => set(name, checked)}
          />
        </label>
      );
    if (
      isType(property, "string") ||
      isType(property, "number") ||
      isType(property, "integer")
    )
      return (
        <ReferenceText
          key={name}
          label={label}
          hint={property.description}
          outputs={outputs}
          includeTrigger={includeTrigger}
          multiline={
            isType(property, "string") &&
            (longTextNames.test(name) || (property.maxLength ?? 0) > 300)
          }
          value={
            isJsonString(current)
              ? current
              : current === undefined
                ? ""
                : JSON.stringify(current)
          }
          onChange={(next) => {
            const numeric =
              !isType(property, "string") &&
              /^-?\d+(\.\d+)?$/u.test(next.trim());
            set(name, numeric ? Number(next) : next);
          }}
        />
      );
    return (
      <JsonField
        key={name}
        label={label}
        hint={property.description}
        value={current}
        onChange={(next) => set(name, next)}
      />
    );
  };
  return (
    <div className="space-y-3">
      {requiredNames.map(field)}
      {optionalNames.length ? (
        showOptional || requiredNames.length === 0 ? (
          optionalNames.map(field)
        ) : (
          <button
            type="button"
            onClick={() => setShowOptional(true)}
            className="text-muted-foreground hover:text-foreground text-[11px]"
          >
            More options ({optionalNames.length})
          </button>
        )
      ) : null}
    </div>
  );
}
