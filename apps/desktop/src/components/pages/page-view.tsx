import type { ComputedFunction, Spec } from "@json-render/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { defineCatalog, VisibilityConditionSchema } from "@json-render/core";
import {
  createStateStore,
  defineRegistry,
  JSONUIProvider,
  Renderer,
} from "@json-render/react";
import { schema } from "@json-render/react/schema";
import { toast } from "sonner";
import { z } from "zod";

import type {
  DatabaseWithRows,
  JsonValue,
  PageDocument,
  PageSpec,
} from "@chief/relay-contracts";
import {
  cellAsPerson,
  databaseRowSaveSchema,
  jsonValueSchema,
  pageActions,
  pageComponents,
  parseJsonNumber,
  parsePageDocument,
} from "@chief/relay-contracts";

import type { DatabasePersonOption } from "../databases/database-model";
import { parseRelayError } from "../../lib/relay-runtime-errors";
import { useRelaySession } from "../../lib/relay-session-context";
import { personOf } from "../databases/database-model";
import { usePeople } from "../databases/use-database";
import { pageComponentViews } from "./page-components";

const catalog = defineCatalog(schema, {
  components: Object.fromEntries(
    Object.entries(pageComponents).map(([name, entry]) => [
      name,
      {
        props: entry.props,
        slots: entry.children ? ["default"] : [],
        description: entry.description,
      },
    ]),
  ),
  actions: {},
});

const { registry } = defineRegistry(catalog, {
  components: pageComponentViews,
});

const rowsSchema = z.array(z.record(z.string(), jsonValueSchema));
const countArgsSchema = z.object({
  items: rowsSchema.catch([]),
  field: z.string().optional(),
  equals: jsonValueSchema.optional(),
});

/** Counts rows, or the rows whose field holds a value. */
const count: ComputedFunction = (args) => {
  const { items, field, equals } = countArgsSchema.parse(args);
  return field === undefined
    ? items.length
    : items.filter((item) =>
        equals === undefined
          ? Boolean(item[field])
          : JSON.stringify(item[field]) === JSON.stringify(equals),
      ).length;
};

/** Adds up a field across rows. */
const sum: ComputedFunction = (args) => {
  const { items, field } = countArgsSchema.parse(args);
  return items.reduce(
    (total, item) => total + (parseJsonNumber(item[field ?? ""]) ?? 0),
    0,
  );
};

/**
 * A database's rows as a page reads them: keyed by field name, with options
 * and people by name, so a page can show and filter them as written.
 */
function sourceRows(
  { database, rows }: DatabaseWithRows,
  people: readonly DatabasePersonOption[],
) {
  return rows.map((row) => {
    const values: Record<string, JsonValue> = { id: row.id };
    for (const field of database.fields) {
      const value = row.values[field.id];
      if (value === undefined) continue;
      values[field.name] =
        field.type === "select"
          ? (field.options.find((option) => option.id === value)?.name ?? "")
          : field.type === "person"
            ? (personOf(people, value)?.name ?? cellAsPerson(value)?.id ?? "")
            : jsonValueSchema.catch("").parse(value);
    }
    return values;
  });
}

/** A page artifact, rendered from its stored spec. */
export function PageView({ content }: { content: string }) {
  const parsed = useMemo(() => parsePageDocument(content), [content]);
  if (!parsed.success)
    return (
      <div className="text-muted-foreground mx-auto max-w-lg px-6 py-16 text-center text-[13px] leading-6">
        <p className="text-foreground font-medium">This page can't be shown.</p>
        <p className="mt-1 whitespace-pre-wrap">{parsed.error}</p>
      </div>
    );
  return <LivePage key={content} page={parsed.page} />;
}

type PageHandlers = NonNullable<
  Parameters<typeof JSONUIProvider>[0]["handlers"]
>;

/**
 * The page's spec as the renderer takes it. A visibility condition the
 * renderer can't read hides its element, rather than showing it by mistake.
 */
function rendererSpec(page: PageSpec): Spec {
  return {
    root: page.root,
    ...(page.state ? { state: page.state } : undefined),
    elements: Object.fromEntries(
      Object.entries(page.elements).map(([key, element]) => {
        const visible = VisibilityConditionSchema.safeParse(element.visible);
        return [
          key,
          {
            ...element,
            visible: visible.success ? visible.data : false,
          },
        ];
      }),
    ),
  };
}

function LivePage({ page }: { page: PageDocument }) {
  const spec = useMemo(() => rendererSpec(page.spec), [page]);
  const { client } = useRelaySession();
  const people = usePeople();
  const [store] = useState(() =>
    createStateStore({ ...page.spec.state, sources: {} }),
  );
  const sources = useMemo(() => Object.entries(page.sources ?? {}), [page]);
  const peopleKey = people.map((person) => person.id).join(",");

  // Each source is read with the viewer's own access; one they can't use
  // shows as empty rather than failing the page.
  const load = useCallback(async () => {
    if (!client) return;
    const loaded = await Promise.all(
      sources.map(async ([name, source]) => {
        const data = await client.databases
          .get(source.database)
          .catch(() => undefined);
        return [name, data ? sourceRows(data, people) : []] as const;
      }),
    );
    store.set("/sources", Object.fromEntries(loaded));
    // People only change the names shown, so their list is read by key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, sources, store, peopleKey]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const handlers = useMemo<PageHandlers>(
    () => ({
      saveRow: async (params) => {
        const input = pageActions.saveRow.params.safeParse(params);
        const database = input.success
          ? page.sources?.[input.data.source]?.database
          : undefined;
        if (!client || !input.success || !database) {
          toast.error("This page's button isn't set up correctly.");
          return;
        }
        const id = z.uuid().safeParse(input.data.id);
        const change = databaseRowSaveSchema.safeParse({
          ...(id.success ? { id: id.data } : undefined),
          values: input.data.values,
        });
        if (!change.success) {
          toast.error("Those values don't fit this database.");
          return;
        }
        try {
          await client.databases.saveRow(database, change.data);
          await load();
        } catch (cause) {
          toast.error(parseRelayError(cause).message || "Couldn't save that.");
        }
      },
      refresh: () => load(),
    }),
    [client, load, page.sources],
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-6">
      <JSONUIProvider
        registry={registry}
        store={store}
        handlers={handlers}
        functions={{ count, sum }}
      >
        <Renderer spec={spec} registry={registry} />
      </JSONUIProvider>
    </div>
  );
}
