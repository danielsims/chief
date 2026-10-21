import { z } from "zod";

import { databaseColors, databaseIdSchema } from "./databases";
import { jsonValueSchema } from "./json";

/**
 * Pages: artifacts an agent describes as a tree of Chief's own components
 * (a json-render spec), drawing on the channel's databases. Nothing in a page
 * runs as code: the app renders the components, and buttons can only use the
 * actions listed here, with the viewer's own access.
 */
export const pageMimeType = "application/vnd.chief.page+json";

export const pageLimits = { elements: 200, sources: 8, stateBytes: 20_000 };

const keySchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/u);

/**
 * A prop written as data rather than a literal: a value from the page's
 * state, from the item being repeated, a template, a condition or a computed
 * count or sum.
 */
const bindingSchema = z.union([
  z.object({ $state: z.string().max(200) }).strict(),
  z.object({ $bindState: z.string().max(200) }).strict(),
  z.object({ $item: z.string().max(100) }).strict(),
  z.object({ $bindItem: z.string().max(100) }).strict(),
  z.object({ $index: z.literal(true) }).strict(),
  z.object({ $template: z.string().max(500) }).strict(),
  z
    .object({
      $cond: jsonValueSchema,
      $then: jsonValueSchema,
      $else: jsonValueSchema,
    })
    .strict(),
  z
    .object({
      $computed: z.enum(["count", "sum"]),
      args: z.record(z.string(), jsonValueSchema),
    })
    .strict(),
]);

const bound = <Schema extends z.ZodType>(schema: Schema) =>
  z.union([schema, bindingSchema]);

const text = bound(z.string().max(2_000));
const label = bound(z.string().max(120));
const amount = bound(z.union([z.number(), z.string().max(40)]));
const rows = bound(z.array(z.record(z.string(), jsonValueSchema)).max(1_000));

/** Each component: its props, whether it holds children, and what it's for. */
export const pageComponents = {
  Stack: {
    props: z
      .object({
        direction: z.enum(["vertical", "horizontal"]).optional(),
        gap: z.enum(["sm", "md", "lg"]).optional(),
        align: z.enum(["start", "center", "end", "stretch"]).optional(),
      })
      .strict(),
    children: true,
    description: "Lays children out in a column or a row.",
  },
  Grid: {
    props: z.object({ columns: z.int().min(1).max(4) }).strict(),
    children: true,
    description: "Lays children out in equal columns, such as metric cards.",
  },
  Card: {
    props: z
      .object({ title: label.optional(), description: text.optional() })
      .strict(),
    children: true,
    description: "A bordered panel grouping related content.",
  },
  Heading: {
    props: z
      .object({ text: label, level: z.enum(["1", "2", "3"]).optional() })
      .strict(),
    children: false,
    description: "A section title.",
  },
  Text: {
    props: z
      .object({ text, tone: z.enum(["default", "muted"]).optional() })
      .strict(),
    children: false,
    description: "A line or paragraph of plain text.",
  },
  Markdown: {
    props: z.object({ text: bound(z.string().max(20_000)) }).strict(),
    children: false,
    description: "Formatted text: headings, lists, links, code.",
  },
  Metric: {
    props: z.object({ label, value: amount, hint: label.optional() }).strict(),
    children: false,
    description: "One number with its label, such as a count of open deals.",
  },
  Badge: {
    props: z
      .object({ text: label, color: z.enum(databaseColors).optional() })
      .strict(),
    children: false,
    description: "A small coloured label, such as a status.",
  },
  Progress: {
    props: z
      .object({
        value: amount,
        max: amount.optional(),
        label: label.optional(),
      })
      .strict(),
    children: false,
    description: "A bar showing how far along something is.",
  },
  Table: {
    props: z
      .object({
        rows,
        columns: z
          .array(
            z.object({ key: z.string().max(60), label: z.string().max(60) }),
          )
          .min(1)
          .max(12),
        empty: label.optional(),
      })
      .strict(),
    children: false,
    description:
      "Rows of records as a table; each column shows one key of each row.",
  },
  BarChart: {
    props: z
      .object({
        rows,
        label: z.string().max(60),
        value: z.string().max(60),
        title: label.optional(),
      })
      .strict(),
    children: false,
    description:
      "Horizontal bars, one per row: `label` and `value` name the keys to use.",
  },
  Button: {
    props: z
      .object({
        label,
        variant: z.enum(["primary", "secondary", "ghost"]).optional(),
      })
      .strict(),
    children: false,
    description: "A button; give it an on.press action.",
  },
  TextInput: {
    props: z
      .object({
        label: label.optional(),
        placeholder: label.optional(),
        value: bound(z.string().max(2_000)),
      })
      .strict(),
    children: false,
    description: "A text field; bind value with $bindState.",
  },
  Select: {
    props: z
      .object({
        label: label.optional(),
        options: bound(z.array(z.string().max(120)).max(50)),
        value: bound(z.string().max(120)),
      })
      .strict(),
    children: false,
    description: "A dropdown of options; bind value with $bindState.",
  },
  Link: {
    props: z.object({ label, href: text }).strict(),
    children: false,
    description: "A link to a web page (http or https only).",
  },
  Divider: {
    props: z.object({}).strict(),
    children: false,
    description: "A thin line between sections.",
  },
} as const;

export type PageComponentName = keyof typeof pageComponents;

/** What a page's buttons can do, beyond setting its own state. */
export const pageActions = {
  saveRow: {
    params: z
      .object({
        source: keySchema,
        id: bound(z.string().max(36)).optional(),
        values: z.record(z.string().max(40), jsonValueSchema),
      })
      .strict(),
    description:
      "Adds a row to one of the page's sources, or changes one by id. Cells are keyed by field name.",
  },
  refresh: {
    params: z.object({}).strict(),
    description: "Reads the page's sources again.",
  },
} as const;

const actionBindingSchema = z
  .object({
    // The renderer's own state actions, then Chief's.
    action: z.enum([
      "setState",
      "pushState",
      "removeState",
      "saveRow",
      "refresh",
    ]),
    params: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();

const elementBase = {
  children: z.array(keySchema).max(50),
  /** A condition on state or the repeated item, or a list of them. */
  visible: z
    .union([
      z.boolean(),
      z.record(z.string(), jsonValueSchema),
      z.array(z.record(z.string(), jsonValueSchema)).max(8),
    ])
    .optional(),
  repeat: z
    .object({
      // A state path, or a list on the item an outer repeat is showing.
      statePath: z.union([
        z.string().max(200),
        z.object({ $item: z.string().max(100) }).strict(),
      ]),
      key: z.string().max(60).optional(),
    })
    .strict()
    .optional(),
  on: z
    .partialRecord(
      z.enum(["press", "change", "submit"]),
      z.union([actionBindingSchema, z.array(actionBindingSchema).max(4)]),
    )
    .optional(),
};

function elementOf<Name extends PageComponentName>(name: Name) {
  return z
    .object({
      type: z.literal(name),
      props: pageComponents[name].props,
      ...elementBase,
    })
    .strict();
}

/** One element, with the props of its component. */
export const pageElementSchema = z.discriminatedUnion("type", [
  elementOf("Stack"),
  elementOf("Grid"),
  elementOf("Card"),
  elementOf("Heading"),
  elementOf("Text"),
  elementOf("Markdown"),
  elementOf("Metric"),
  elementOf("Badge"),
  elementOf("Progress"),
  elementOf("Table"),
  elementOf("BarChart"),
  elementOf("Button"),
  elementOf("TextInput"),
  elementOf("Select"),
  elementOf("Link"),
  elementOf("Divider"),
]);

export const pageSpecSchema = z
  .object({
    root: keySchema,
    elements: z.record(keySchema, pageElementSchema),
    /** Starting values for the page's own state, such as form fields. */
    state: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();

/**
 * A page as stored: its spec, and the databases it reads, each loaded into
 * state at /sources/<name> as rows keyed by field name, with an id.
 */
export const pageDocumentSchema = z
  .object({
    sources: z
      .record(keySchema, z.object({ database: databaseIdSchema }).strict())
      .optional(),
    spec: pageSpecSchema,
  })
  .strict();

export type PageSpec = z.infer<typeof pageSpecSchema>;
export type PageDocument = z.infer<typeof pageDocumentSchema>;

/**
 * Reads a stored page, checking what the schema alone can't: limits, that
 * the root and every child exist, and that every element has the children
 * its component allows.
 */
export function parsePageDocument(content: string) {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { success: false as const, error: "The page isn't valid JSON." };
  }
  const parsed = pageDocumentSchema.safeParse(raw);
  if (!parsed.success)
    return {
      success: false as const,
      error: z.prettifyError(parsed.error).slice(0, 2_000),
    };
  const page = parsed.data;
  const { elements, root, state } = page.spec;
  const keys = Object.keys(elements);
  const problems = [
    ...(keys.length > pageLimits.elements
      ? [`A page can have ${pageLimits.elements} elements.`]
      : []),
    ...(Object.keys(page.sources ?? {}).length > pageLimits.sources
      ? [`A page can read ${pageLimits.sources} sources.`]
      : []),
    ...(JSON.stringify(state ?? {}).length > pageLimits.stateBytes
      ? ["The page's starting state is too large."]
      : []),
    ...(elements[root] ? [] : [`The root element "${root}" doesn't exist.`]),
    ...keys.flatMap((key) => {
      const element = elements[key];
      if (!element) return [];
      return [
        ...(element.children.length && !pageComponents[element.type].children
          ? [`${key}: ${element.type} can't hold children.`]
          : []),
        ...element.children.flatMap((child) =>
          elements[child] ? [] : [`${key}: child "${child}" doesn't exist.`],
        ),
      ];
    }),
  ];
  return problems.length
    ? { success: false as const, error: problems.slice(0, 20).join("\n") }
    : { success: true as const, page };
}

/**
 * How to write a page, for the agent tool that saves one: each component
 * with its props, and the actions and bindings a page can use.
 */
export function pageGuide() {
  const components = Object.entries(pageComponents).map(([name, entry]) => {
    const propTypes: Record<string, z.ZodType> = entry.props.shape;
    const props = Object.entries(propTypes).map(([prop, schema]) =>
      schema.safeParse(undefined).success ? `${prop}?` : prop,
    );
    return `- ${name} { ${props.join(", ")} }${entry.children ? " (holds children)" : ""}: ${entry.description}`;
  });
  const actions = Object.entries(pageActions).map(
    ([name, entry]) => `- ${name}: ${entry.description}`,
  );
  return [
    'A page is { "sources": { name: { "database": id } }, "spec": { "root": key, "elements": { key: { "type", "props", "children": [keys] } }, "state"?: {} } }.',
    "Each source's rows are in state at /sources/<name>, as objects keyed by field name plus id. Show data from sources; don't invent it.",
    'Any prop can be data: { "$state": "/path" }, { "$item": "Field" } inside a repeat, { "$template": "${/path} open" }, { "$computed": "count" | "sum", "args": { "items": { "$state": "/sources/x" }, "field"?: "Field", "equals"?: value } }. Inputs bind with { "$bindState": "/form/x" }.',
    'Repeat a container\'s children for each row with "repeat": { "statePath": "/sources/x", "key": "id" }; filter with "visible": { "$item": "Status", "eq": "Open" }.',
    'Buttons act with "on": { "press": { "action": name, "params": {} } }. Actions: setState { statePath, value }, pushState, removeState, and:',
    ...actions,
    "Components:",
    ...components,
  ].join("\n");
}
