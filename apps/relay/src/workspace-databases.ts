import { z } from "zod";

import type {
  Database,
  DatabaseField,
  DatabaseRow,
  DatabaseRowSource,
  DatabaseValue,
  Principal,
} from "@chief/relay-contracts";
import {
  boardTemplate,
  cellAsFlag,
  cellAsNumber,
  cellAsPerson,
  cellAsText,
  databaseIdSchema,
  databaseLimits,
  databaseRowSaveSchema,
  databaseRowSchema,
  databaseSaveSchema,
  databaseSchema,
  parsePageDocument,
  workspaceBoardId,
} from "@chief/relay-contracts";

import type { WorkspaceChannelStore } from "./workspace-channel-store";
import { HttpError, json, parseJson } from "./http";
import { databasesDeleteDatabase } from "./queries/databases/delete-database";
import { databasesDeleteRow } from "./queries/databases/delete-row";
import { databasesFindListDatabases } from "./queries/databases/find-list-databases";
import { databasesFindListRows } from "./queries/databases/find-list-rows";
import { databasesUpsertDatabase } from "./queries/databases/upsert-database";
import { databasesUpsertRow } from "./queries/databases/upsert-row";
import { readWorkspaceSchedule } from "./workspace-schedule-store";

/**
 * Databases: typed rows people and agents keep together, shown as a table or
 * a board. One in a channel is for whoever can read that channel, so a private
 * board is one in a private channel; one in no channel is for the workspace.
 */

function workspaceBoard(now: number): Database {
  return {
    id: workspaceBoardId,
    name: "Workspace Board",
    ...boardTemplate(),
    createdAt: now,
    updatedAt: now,
  };
}

const notFound = () =>
  new HttpError(404, "database_not_found", "Database not found.");

const invalid = (message: string) =>
  new HttpError(400, "database_invalid", message);

function readDatabases(storage: DurableObjectStorage) {
  return databasesFindListDatabases<{ database_json: string }>(storage).flatMap(
    (row) => {
      const database = databaseSchema.safeParse(JSON.parse(row.database_json));
      return database.success ? [database.data] : [];
    },
  );
}

function writeDatabase(storage: DurableObjectStorage, database: Database) {
  databasesUpsertDatabase(storage, {
    databaseId: database.id,
    conversationId: database.conversationId ?? "",
    databaseJson: JSON.stringify(databaseSchema.parse(database)),
    updatedAt: database.updatedAt,
  });
}

function readRows(storage: DurableObjectStorage, databaseId: string) {
  return databasesFindListRows<{ row_json: string }>(storage, databaseId)
    .flatMap((row) => {
      const parsed = databaseRowSchema.safeParse(JSON.parse(row.row_json));
      return parsed.success ? [parsed.data] : [];
    })
    .sort((left, right) => left.position - right.position);
}

function writeRow(
  storage: DurableObjectStorage,
  databaseId: string,
  row: DatabaseRow,
) {
  databasesUpsertRow(storage, {
    rowId: row.id,
    databaseId,
    rowJson: JSON.stringify(databaseRowSchema.parse(row)),
    updatedAt: row.updatedAt,
  });
}

function databases(storage: DurableObjectStorage) {
  const all = readDatabases(storage);
  if (all.some((database) => database.id === workspaceBoardId)) return all;
  const board = workspaceBoard(Date.now());
  writeDatabase(storage, board);
  return [...all, board];
}

/** One title field, first; unique ids; boards grouped by a select field. */
function checkStructure(fields: DatabaseField[], views: Database["views"]) {
  if (fields[0]?.type !== "title" || fields.slice(1).some(isTitle))
    throw invalid("A database needs one title field, first.");
  if (new Set(fields.map((field) => field.id)).size !== fields.length)
    throw invalid("Each field needs its own id.");
  for (const field of fields)
    if (
      field.type === "select" &&
      new Set(field.options.map((option) => option.id)).size !==
        field.options.length
    )
      throw invalid(`Each option in ${field.name} needs its own id.`);
  if (new Set(views.map((view) => view.id)).size !== views.length)
    throw invalid("Each view needs its own id.");
  for (const view of views)
    if (
      view.layout === "board" &&
      fields.find((field) => field.id === view.groupBy)?.type !== "select"
    )
      throw invalid(`${view.name} needs a select field to group by.`);
}

function isTitle(field: DatabaseField) {
  return field.type === "title";
}

/** The field a cell key names, by id or, for agents' convenience, by name. */
function fieldFor(fields: DatabaseField[], key: string) {
  const lower = key.toLowerCase();
  return (
    fields.find((field) => field.id === key) ??
    fields.find((field) => field.name.toLowerCase() === lower)
  );
}

/** A cell as its field stores it, or undefined when it is empty. */
function cellValue(field: DatabaseField, value: DatabaseValue) {
  const wrong = () => invalid(`${field.name} can't hold that value.`);
  const text = () => {
    const read = cellAsText(value);
    if (read === undefined) throw wrong();
    return read.trim();
  };
  switch (field.type) {
    case "title":
    case "text": {
      const read = text();
      if (field.type === "title" && read.length > 200)
        throw invalid(`${field.name} is limited to 200 characters.`);
      return read || undefined;
    }
    case "url": {
      const read = text();
      if (!read) return undefined;
      const url = URL.parse(read);
      if (url?.protocol !== "https:" && url?.protocol !== "http:")
        throw invalid(`${field.name} needs a web address.`);
      return url.href;
    }
    case "number": {
      const read = cellAsNumber(value);
      if (read === undefined) throw wrong();
      return read;
    }
    case "checkbox": {
      const read = cellAsFlag(value);
      if (read === undefined) throw wrong();
      return read || undefined;
    }
    case "date": {
      const read = text();
      if (read && !/^\d{4}-\d{2}-\d{2}$/u.test(read))
        throw invalid(`${field.name} needs a date as YYYY-MM-DD.`);
      return read || undefined;
    }
    case "select": {
      const read = text();
      if (!read) return undefined;
      const lower = read.toLowerCase();
      const option =
        field.options.find((candidate) => candidate.id === read) ??
        field.options.find(
          (candidate) => candidate.name.toLowerCase() === lower,
        );
      if (!option) throw invalid(`${field.name} has no option "${read}".`);
      return option.id;
    }
    case "person": {
      const read = cellAsPerson(value);
      if (!read) throw wrong();
      return read;
    }
  }
}

/** Cells that still fit the fields, after the fields change. */
function keptValues(values: DatabaseRow["values"], fields: DatabaseField[]) {
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) => {
      const field = fields.find((candidate) => candidate.id === key);
      if (!field) return [];
      try {
        const kept = cellValue(field, value);
        return kept === undefined ? [] : [[key, kept]];
      } catch {
        return [];
      }
    }),
  );
}

export async function routeWorkspaceDatabases(
  storage: DurableObjectStorage,
  request: Request,
  operation: string,
  principal: Principal,
  channels: WorkspaceChannelStore,
) {
  if (principal.kind !== "user" && principal.kind !== "agent")
    throw new HttpError(
      403,
      "database_access_denied",
      "Only workspace members can use databases.",
    );
  const canRead = (conversationId: string) =>
    channels.canReadConversation(conversationId, principal);
  const requireChannel = (conversationId: string) => {
    if (!canRead(conversationId))
      throw new HttpError(404, "channel_not_found", "Channel not found.");
    return conversationId;
  };
  const all = databases(storage);
  // A database outside any channel belongs to the whole workspace.
  const usable = (database: Database) =>
    !database.conversationId || canRead(database.conversationId);
  const visible = all.filter(usable);
  // A database the caller can't see answers as missing, so it isn't revealed.
  const target = () => {
    const id = databaseIdSchema.safeParse(
      request.headers.get("x-chief-database-id"),
    );
    const database = id.success
      ? visible.find((candidate) => candidate.id === id.data)
      : undefined;
    if (!database) throw notFound();
    return database;
  };

  if (operation === "data-databases-list") {
    const conversationId = new URL(request.url).searchParams.get(
      "conversationId",
    );
    return json({
      databases: conversationId
        ? visible.filter(
            (database) => database.conversationId === conversationId,
          )
        : visible,
    });
  }

  if (operation === "data-database-get") {
    const database = target();
    return json({ database, rows: readRows(storage, database.id) });
  }

  if (operation === "data-database-delete") {
    const database = target();
    if (principal.kind !== "user")
      throw new HttpError(
        403,
        "database_delete_denied",
        "Only people can delete a database.",
      );
    if (database.id === workspaceBoardId)
      throw new HttpError(
        409,
        "database_required",
        "The workspace board can't be deleted.",
      );
    databasesDeleteDatabase(storage, database.id);
    return json({ deleted: true });
  }

  if (operation === "data-database-save") {
    const input = databaseSaveSchema.parse(await parseJson(request));
    const current = input.id
      ? all.find((database) => database.id === input.id)
      : undefined;
    if (current && !usable(current)) throw notFound();
    // A new database may bring its own id, so a retried create is one save.
    if (!current && input.id && !z.uuid().safeParse(input.id).success)
      throw notFound();
    if (!current && all.length >= databaseLimits.databases)
      throw new HttpError(
        409,
        "database_limit",
        `This workspace has ${databaseLimits.databases} databases. Delete one before adding another.`,
      );
    if (!current && !input.name) throw invalid("A new database needs a name.");
    const fields = input.fields ??
      current?.fields ?? [{ id: "title", name: "Name", type: "title" }];
    const views = input.views ??
      current?.views ?? [{ id: "table", name: "Table", layout: "table" }];
    checkStructure(fields, views);
    const conversationId =
      input.conversationId === undefined
        ? current?.conversationId
        : (input.conversationId ?? undefined);
    const now = Date.now();
    const database: Database = {
      id: current?.id ?? input.id ?? crypto.randomUUID(),
      ...(conversationId
        ? { conversationId: requireChannel(conversationId) }
        : undefined),
      name: input.name ?? current?.name ?? "",
      fields,
      views,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    };
    storage.transactionSync(() => {
      writeDatabase(storage, database);
      // Cells that no longer fit a changed or removed field are emptied.
      if (current && input.fields)
        for (const row of readRows(storage, database.id))
          writeRow(storage, database.id, {
            ...row,
            values: keptValues(row.values, fields),
          });
    });
    return json(database);
  }

  if (operation === "data-database-row-delete") {
    const database = target();
    const id = z
      .uuid()
      .safeParse(request.headers.get("x-chief-database-row-id"));
    if (
      !id.success ||
      !readRows(storage, database.id).some((row) => row.id === id.data)
    )
      throw new HttpError(404, "database_row_not_found", "Row not found.");
    databasesDeleteRow(storage, database.id, id.data);
    return json({ deleted: true });
  }

  if (operation !== "data-database-row-save") return undefined;
  const database = target();
  const input = databaseRowSaveSchema.parse(await parseJson(request));
  const rows = readRows(storage, database.id);
  const current = input.id
    ? rows.find((row) => row.id === input.id)
    : undefined;
  if (!current && rows.length >= databaseLimits.rows)
    throw new HttpError(
      409,
      "database_full",
      `${database.name} has ${databaseLimits.rows} rows. Remove some before adding more.`,
    );
  const values: DatabaseRow["values"] = { ...current?.values };
  for (const [key, value] of Object.entries(input.values ?? {})) {
    const field = fieldFor(database.fields, key);
    if (!field) throw invalid(`${database.name} has no field "${key}".`);
    const cell = value === null ? undefined : cellValue(field, value);
    // Someone newly put in a cell must belong to the workspace.
    const person = cellAsPerson(cell);
    const previous = cellAsPerson(values[field.id]);
    if (person && (previous?.kind !== person.kind || previous.id !== person.id))
      channels.requireWorkspaceMember(person.kind, person.id);
    if (cell === undefined) delete values[field.id];
    else values[field.id] = cell;
  }
  const source =
    input.source === undefined ? current?.source : (input.source ?? undefined);
  if (input.source) requireChannel(sourceChannel(storage, input.source) ?? "");
  const now = Date.now();
  const row: DatabaseRow = {
    id: current?.id ?? input.id ?? crypto.randomUUID(),
    values,
    body: input.body?.trim() ?? current?.body ?? "",
    // New rows go first, so they're seen.
    position:
      input.position ??
      current?.position ??
      Math.min(0, ...rows.map((other) => other.position)) - 1,
    ...(source ? { source } : undefined),
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  writeRow(storage, database.id, row);
  return json(row);
}

function sourceChannel(
  storage: DurableObjectStorage,
  source: DatabaseRowSource,
) {
  return source.kind === "thread"
    ? source.conversationId
    : readWorkspaceSchedule(storage, source.scheduleId)?.schedule
        .conversationId;
}

/** The databases a member can use, by id. */
export function usableDatabaseIds(
  storage: DurableObjectStorage,
  channels: WorkspaceChannelStore,
  principal: Principal,
) {
  return new Set(
    databases(storage).flatMap((database) =>
      !database.conversationId ||
      channels.canReadConversation(database.conversationId, principal)
        ? [database.id]
        : [],
    ),
  );
}

/**
 * Refuses a page that isn't a valid spec, or that reads a database the one
 * saving it can't use, with a message an agent can act on.
 */
export function requireValidPage(content: string, usable: Set<string>) {
  const parsed = parsePageDocument(content);
  if (!parsed.success) throw new HttpError(400, "page_invalid", parsed.error);
  for (const [name, source] of Object.entries(parsed.page.sources ?? {}))
    if (!usable.has(source.database))
      throw new HttpError(
        400,
        "page_source_unknown",
        `Source "${name}": there's no database ${source.database} you can use.`,
      );
}
