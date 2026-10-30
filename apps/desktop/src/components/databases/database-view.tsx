import type { ReactNode } from "react";
import { useState } from "react";
import {
  Check,
  CircleAlert,
  Columns3,
  ListFilter,
  Plus,
  Table2,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router";

import type { DatabaseRow, DatabaseView as View } from "@chief/relay-contracts";
import { cellAsPerson, databasePersonSchema } from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@chief/ui/components/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@chief/ui/components/dropdown-menu";
import { cn } from "@chief/ui/lib/utils";

import type { RowPanelTarget } from "./database-row-panel";
import { useAuth } from "../../lib/auth/auth-context";
import { useChiefNavigation } from "../../lib/chief-navigation-context";
import { insetBandClass, insetCardClass } from "../inset-card";
import { DatabaseActions } from "./database-actions";
import { DatabaseBoard } from "./database-board";
import { PersonAvatar } from "./database-cells";
import { firstField, newKey } from "./database-model";
import { databaseViews, selectedDatabaseView } from "./database-presentation";
import { DatabaseRowPanel } from "./database-row-panel";
import { DatabaseTable } from "./database-table";
import { useDatabase, usePeople } from "./use-database";

const tabClass =
  "text-muted-foreground hover:text-foreground inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors data-[active=true]:bg-foreground/[0.05] data-[active=true]:text-foreground";

/**
 * A database as one of its views, a table or a board, with its rows opened
 * in a side panel. `leading` starts the toolbar and `actions` end it.
 */
export function DatabaseView({
  databaseId,
  leading,
  newLabel = "New",
  actions,
  onDeleted,
}: {
  databaseId: string;
  leading?: ReactNode;
  /** What adding a row is called, such as "New action item"; null hides it. */
  newLabel?: string | null;
  actions?: ReactNode;
  onDeleted?: () => void;
}) {
  const state = useDatabase(databaseId);
  const people = usePeople();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const chiefNavigation = useChiefNavigation();
  const [viewId, setViewId] = useState<string>();
  /** Whose rows are shown: anyone's, nobody's, or one person's. */
  const [assignee, setAssignee] = useState<string>("anyone");
  const [initialField, setInitialField] = useState<string>();
  const [pendingRow, setPendingRow] = useState<{
    target: RowPanelTarget;
    fieldId?: string;
  } | null>(null);
  const [dialog, setDialog] = useState<RowPanelTarget | null>(null);
  const database = state.data?.database;

  if (!database)
    return (
      <div className="grid min-h-0 flex-1 place-items-center px-6">
        {state.error ? (
          <div role="alert" className={cn(insetBandClass, "w-full max-w-sm")}>
            <div className={cn(insetCardClass, "flex items-start gap-3")}>
              <CircleAlert
                size={16}
                className="text-muted-foreground mt-0.5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-medium">
                  Couldn't load this database
                </p>
                <p className="text-muted-foreground mt-1 text-[13px] leading-5">
                  {state.error}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={state.refresh}
                >
                  Try again
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Loading…</p>
        )}
      </div>
    );

  const views = databaseViews(database);
  const view = selectedDatabaseView(views, viewId);
  const group = database.fields.find(
    (field) => field.id === view?.groupBy && field.type === "select",
  );
  const person = firstField(database, "person");
  const keyOf = (value: { kind: string; id: string }) =>
    `${value.kind}:${value.id}`;
  const myKey = user ? `user:${user.id}` : "";
  const rows = (state.data?.rows ?? []).filter((row) => {
    if (assignee === "anyone" || !person) return true;
    const value = cellAsPerson(row.values[person.id]);
    return assignee === "nobody" ? !value : value && keyOf(value) === assignee;
  });
  const filtered = people.find((option) => keyOf(option) === assignee);
  // A new row starts in the board's first lane, and with whoever the board
  // is filtered to.
  const filteredPerson = databasePersonSchema.safeParse(
    filtered ? { kind: filtered.kind, id: filtered.id } : undefined,
  );
  const newRowValues = (): DatabaseRow["values"] => ({
    ...(view?.layout === "board" && group?.type === "select" && group.options[0]
      ? { [group.id]: group.options[0].id }
      : undefined),
    ...(person && filteredPerson.success
      ? { [person.id]: filteredPerson.data }
      : undefined),
  });
  const openRow = (target: RowPanelTarget, fieldId?: string) => {
    if (
      dialog &&
      ("id" in dialog ? dialog.id : "new") !==
        ("id" in target ? target.id : "new")
    ) {
      setPendingRow({ target, fieldId });
      return;
    }
    setInitialField(fieldId);
    setDialog(
      "id" in target
        ? target
        : { values: { ...newRowValues(), ...target.values } },
    );
  };
  const saveViews = (next: View[], message: string) =>
    state.saveDatabase({ views: next }, message);
  const addView = async (next: View) => {
    if (views.some((view) => view.layout === next.layout)) return;
    if (await saveViews([...views, next], "Couldn't add that view."))
      setViewId(next.id);
  };
  const removeView = async (target: View) => {
    if (views.length < 2) return;
    if (
      await saveViews(
        views.filter((view) => view.layout !== target.layout),
        "Couldn't remove that view.",
      )
    )
      setViewId(undefined);
  };
  const openSource = (row: DatabaseRow) => {
    // Keep the editor mounted until the router has allowed navigation.
    if (row.source?.kind === "thread")
      chiefNavigation.open({
        kind: "conversation",
        channelId: row.source.conversationId,
        threadRootId: row.source.threadRootId,
      });
    else if (row.source?.kind === "automation")
      void navigate(
        `/schedule/automations/${encodeURIComponent(row.source.scheduleId)}`,
      );
  };

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-6 pb-3">
          {leading}
          {views.length > 0 && (
            <div className="flex min-w-0 items-center gap-0.5" role="tablist">
              {[...views]
                .sort(
                  (a, b) =>
                    Number(b.layout === "board") - Number(a.layout === "board"),
                )
                .map((candidate) => {
                  const active = candidate.id === view?.id;
                  const Icon = candidate.layout === "board" ? Columns3 : Table2;
                  return (
                    <ContextMenu key={candidate.id}>
                      <ContextMenuTrigger asChild>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={active}
                          data-active={active || undefined}
                          className={tabClass}
                          onClick={() => setViewId(candidate.id)}
                        >
                          <Icon size={13} />
                          {candidate.name}
                        </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem
                          disabled={views.length === 1}
                          onSelect={() => void removeView(candidate)}
                        >
                          Remove view
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })}
              {views.length < 2 &&
              (!views.some((view) => view.layout === "table") ||
                database.fields.some((field) => field.type === "select")) ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label="Add view"
                    title="Add view"
                    className={cn(tabClass, "px-1.5")}
                  >
                    <Plus size={13} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {!views.some((view) => view.layout === "table") ? (
                      <DropdownMenuItem
                        onSelect={() =>
                          void addView({
                            id: newKey("view"),
                            name: "Database",
                            layout: "table",
                          })
                        }
                      >
                        <Table2 size={13} />
                        Database
                      </DropdownMenuItem>
                    ) : null}
                    {!views.some((view) => view.layout === "board") &&
                    database.fields.some((field) => field.type === "select") ? (
                      <>
                        <DropdownMenuSeparator />
                        <p className="text-muted-foreground px-2 py-1 text-[11px]">
                          Board by
                        </p>
                        {database.fields.map((field) =>
                          field.type === "select" ? (
                            <DropdownMenuItem
                              key={field.id}
                              onSelect={() =>
                                addView({
                                  id: newKey("view"),
                                  name: "Board",
                                  layout: "board",
                                  groupBy: field.id,
                                })
                              }
                            >
                              <Columns3 size={13} />
                              {field.name}
                            </DropdownMenuItem>
                          ) : null,
                        )}
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {person ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={assignee === "anyone" ? "ghost" : "secondary"}
                    size="sm"
                    className="text-[12px]"
                  >
                    <ListFilter size={13} />
                    {assignee === "anyone"
                      ? "Filter"
                      : assignee === "nobody"
                        ? "Unassigned"
                        : assignee === myKey
                          ? "Assigned to me"
                          : (filtered?.name ?? "Filter")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  <p className="text-muted-foreground px-2 pt-1 pb-1.5 text-[11px]">
                    {person.name}
                  </p>
                  {(
                    [
                      ["anyone", "Anyone"],
                      ...(myKey ? [[myKey, "Assigned to me"] as const] : []),
                      ["nobody", "Unassigned"],
                    ] as const
                  ).map(([key, label]) => (
                    <DropdownMenuItem
                      key={key}
                      onSelect={() => setAssignee(key)}
                    >
                      {label}
                      {assignee === key ? (
                        <Check size={13} className="ml-auto" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <div className="max-h-56 overflow-y-auto">
                    {people
                      .filter((option) => keyOf(option) !== myKey)
                      .map((option) => (
                        <DropdownMenuItem
                          key={keyOf(option)}
                          onSelect={() => setAssignee(keyOf(option))}
                        >
                          <PersonAvatar person={option} />
                          <span className="truncate">{option.name}</span>
                          {assignee === keyOf(option) ? (
                            <Check size={13} className="ml-auto" />
                          ) : null}
                        </DropdownMenuItem>
                      ))}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {newLabel ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => openRow({ values: {} })}
              >
                <Plus size={13} />
                {newLabel}
              </Button>
            ) : null}
            {actions}
            <DatabaseActions
              database={database}
              onDeleted={() => {
                if (onDeleted) onDeleted();
                else if (location.pathname === "/conversations") {
                  const params = new URLSearchParams(location.search);
                  params.delete("artifact");
                  params.delete("database");
                  void navigate(`${location.pathname}?${params}`);
                } else void navigate("/artifacts");
              }}
            />
          </div>
        </div>
        {view?.layout === "board" && group?.type !== "select" ? (
          <div
            role="status"
            className="text-muted-foreground px-6 py-12 text-center text-sm"
          >
            This database needs a board view grouped by a select field.
          </div>
        ) : view?.layout === "board" && group?.type === "select" ? (
          <DatabaseBoard
            state={state}
            rows={rows}
            group={group}
            people={people}
            onOpenRow={openRow}
            selectedRowId={dialog && "id" in dialog ? dialog.id : undefined}
          />
        ) : (
          <DatabaseTable
            state={state}
            rows={rows}
            people={people}
            onOpenRow={openRow}
          />
        )}
      </div>
      {dialog ? (
        <DatabaseRowPanel
          key={"id" in dialog ? dialog.id : "new"}
          database={database}
          target={dialog}
          initialField={initialField}
          people={people}
          closingRequested={Boolean(pendingRow)}
          onKeepEditing={() => setPendingRow(null)}
          onClose={() => {
            setDialog(pendingRow?.target ?? null);
            setInitialField(pendingRow?.fieldId);
            setPendingRow(null);
          }}
          onSubmit={state.saveRow}
          onOpenSource={openSource}
          onRemove={(row) => {
            setDialog(null);
            void state.removeRow(row);
          }}
        />
      ) : null}
    </div>
  );
}
