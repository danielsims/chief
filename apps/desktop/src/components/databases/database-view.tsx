import type { ReactNode } from "react";
import { useState } from "react";
import { Check, Columns3, ListFilter, Plus, Table2 } from "lucide-react";
import { useNavigate } from "react-router";

import type { DatabaseRow, DatabaseView as View } from "@chief/relay-contracts";
import {
  cellAsPerson,
  databaseLimits,
  databasePersonSchema,
} from "@chief/relay-contracts";
import { Button } from "@chief/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@chief/ui/components/dropdown-menu";
import { cn } from "@chief/ui/lib/utils";

import type { RowDialogTarget } from "./database-row-dialog";
import { useAuth } from "../../lib/auth/auth-context";
import { useChiefNavigation } from "../../lib/chief-navigation-context";
import { DatabaseBoard } from "./database-board";
import { InlineField, PersonAvatar } from "./database-cells";
import { firstField, newKey } from "./database-model";
import { DatabaseRowDialog } from "./database-row-dialog";
import { DatabaseTable } from "./database-table";
import { useDatabase, usePeople } from "./use-database";

const tabClass =
  "text-muted-foreground hover:text-foreground inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors data-[active=true]:bg-foreground/[0.05] data-[active=true]:text-foreground";

/**
 * A database as one of its views, a table or a board, with its rows opened
 * in a dialog. `leading` starts the toolbar and `actions` end it.
 */
export function DatabaseView({
  databaseId,
  boardOnly = false,
  compact = false,
  leading,
  newLabel = "New",
  actions,
}: {
  databaseId: string;
  /** Shows only the board, with no other views to switch to. */
  boardOnly?: boolean;
  /** Opened inside a channel: switches between existing views, nothing more. */
  compact?: boolean;
  leading?: ReactNode;
  /** What adding a row is called, such as "New action item"; null hides it. */
  newLabel?: string | null;
  actions?: ReactNode;
}) {
  const state = useDatabase(databaseId);
  const people = usePeople();
  const { user } = useAuth();
  const navigate = useNavigate();
  const chiefNavigation = useChiefNavigation();
  const [viewId, setViewId] = useState<string>();
  const [renaming, setRenaming] = useState(false);
  /** Whose rows are shown: anyone's, nobody's, or one person's. */
  const [assignee, setAssignee] = useState<string>("anyone");
  const [dialog, setDialog] = useState<RowDialogTarget | null>(null);
  const database = state.data?.database;

  if (!database)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {state.error ? (
          <p className="text-destructive px-6 text-sm">{state.error}</p>
        ) : null}
      </div>
    );

  const { views } = database;
  const view =
    (boardOnly
      ? views.find((candidate) => candidate.layout === "board")
      : views.find((candidate) => candidate.id === viewId)) ?? views[0];
  const group = database.fields.find(
    (field) => field.id === view?.groupBy && field.type === "select",
  );
  // A board is used as a board: never put table/view controls above it.
  const hideViewControls = boardOnly || view?.layout === "board";
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
  const openRow = (target: RowDialogTarget) =>
    setDialog(
      "id" in target
        ? target
        : { values: { ...newRowValues(), ...target.values } },
    );
  const saveViews = (next: View[], message: string) =>
    void state.saveDatabase({ views: next }, message);
  const addView = (next: View) => {
    saveViews([...views, next], "Couldn't add that view.");
    setViewId(next.id);
  };
  const openSource = (row: DatabaseRow) => {
    setDialog(null);
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-6 pb-3">
        {leading}
        {hideViewControls || (compact && views.length < 2) ? null : (
          <div className="flex min-w-0 items-center gap-0.5" role="tablist">
            {views.map((candidate) => {
              const active = candidate.id === view?.id;
              const Icon = candidate.layout === "board" ? Columns3 : Table2;
              if (active && renaming)
                return (
                  <div key={candidate.id} className={cn(tabClass, "w-32")}>
                    <InlineField
                      initial={candidate.name}
                      placeholder="View name"
                      maxLength={40}
                      className="text-[12px]"
                      onCommit={(name) => {
                        setRenaming(false);
                        if (name)
                          saveViews(
                            views.map((other) =>
                              other.id === candidate.id
                                ? { ...other, name }
                                : other,
                            ),
                            "Couldn't rename that view.",
                          );
                      }}
                      onCancel={() => setRenaming(false)}
                    />
                  </div>
                );
              const label = (
                <>
                  <Icon size={13} />
                  {candidate.name}
                </>
              );
              // The open view's tab opens its menu; the others switch to it.
              return active ? (
                <DropdownMenu key={candidate.id}>
                  <DropdownMenuTrigger
                    role="tab"
                    aria-selected
                    data-active
                    className={tabClass}
                  >
                    {label}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    onCloseAutoFocus={(event) => event.preventDefault()}
                  >
                    <DropdownMenuItem onSelect={() => setRenaming(true)}>
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      disabled={views.length === 1}
                      onSelect={() => {
                        setViewId(undefined);
                        saveViews(
                          views.filter((other) => other.id !== candidate.id),
                          "Couldn't delete that view.",
                        );
                      }}
                    >
                      Delete view
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <button
                  key={candidate.id}
                  type="button"
                  role="tab"
                  aria-selected={false}
                  className={tabClass}
                  onClick={() => setViewId(candidate.id)}
                >
                  {label}
                </button>
              );
            })}
            {!compact && views.length < databaseLimits.views ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Add view"
                  title="Add view"
                  className={cn(tabClass, "px-1.5")}
                >
                  <Plus size={13} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onSelect={() =>
                      addView({
                        id: newKey("view"),
                        name: "Table",
                        layout: "table",
                      })
                    }
                  >
                    <Table2 size={13} />
                    Table
                  </DropdownMenuItem>
                  {database.fields.some((field) => field.type === "select") ? (
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
                  <DropdownMenuItem key={key} onSelect={() => setAssignee(key)}>
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
        </div>
      </div>
      {state.error ? (
        <p className="text-destructive px-6 pb-2 text-sm">{state.error}</p>
      ) : null}
      {view?.layout === "board" && group?.type === "select" ? (
        <DatabaseBoard
          state={state}
          rows={rows}
          group={group}
          people={people}
          onOpenRow={openRow}
          onOpenSource={openSource}
        />
      ) : (
        <DatabaseTable
          state={state}
          rows={rows}
          people={people}
          onOpenRow={openRow}
        />
      )}
      {dialog ? (
        <DatabaseRowDialog
          key={"id" in dialog ? dialog.id : "new"}
          database={database}
          target={dialog}
          people={people}
          onClose={() => setDialog(null)}
          onSubmit={(change) => {
            setDialog(null);
            void state.saveRow(change);
          }}
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
