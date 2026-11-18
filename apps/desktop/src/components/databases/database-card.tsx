import { ArrowUpRight } from "lucide-react";
import { useNavigate } from "react-router";

import type { GenerativeDatabaseData } from "@chief/agent-runtime/types";
import { Button } from "@chief/ui/components/button";
import { MatrixLoader } from "@chief/ui/components/matrix-loader";
import { cn } from "@chief/ui/lib/utils";

import { insetBandClass, insetCardClass } from "../inset-card";
import { DatabaseBoard } from "./database-board";
import { DatabaseTable } from "./database-table";
import { useDatabase, usePeople } from "./use-database";

/**
 * A database an agent showed in a conversation: the app's own table or board
 * in a card sized for a thread, reading the database live. A board's lanes
 * are cards already, so they sit on the band without a second surface.
 */
export function DatabaseCard({ data }: { data: GenerativeDatabaseData }) {
  const state = useDatabase(data.databaseId);
  const people = usePeople();
  const navigate = useNavigate();
  const database = state.data?.database;
  const boardView = database?.views.find((view) => view.layout === "board");
  const group = database?.fields.find(
    (field) => field.id === boardView?.groupBy,
  );
  // A board shows when one was asked for and the database has a lane field.
  const boardGroup =
    data.view === "board" && group?.type === "select" ? group : undefined;
  const board = boardGroup !== undefined;
  const open = () =>
    void navigate(
      board
        ? `/boards?board=${encodeURIComponent(data.databaseId)}`
        : `/artifacts/databases/${encodeURIComponent(data.databaseId)}`,
    );
  const content = !state.data ? (
    <div className="text-muted-foreground flex min-h-40 flex-1 items-center justify-center gap-2 text-[12px]">
      {state.error ? (
        "This database isn't available."
      ) : (
        <MatrixLoader size={12} ariaLabel="Loading" />
      )}
    </div>
  ) : boardGroup ? (
    <DatabaseBoard
      state={state}
      rows={state.data.rows}
      group={boardGroup}
      people={people}
      onOpenRow={open}
    />
  ) : (
    <DatabaseTable
      state={state}
      rows={state.data.rows}
      people={people}
      onOpenRow={open}
    />
  );
  return (
    <section
      aria-label={database?.name ?? data.title}
      className={cn(insetBandClass, "block w-full max-w-2xl text-left")}
    >
      <span
        className={cn(
          "text-muted-foreground flex h-7 items-center gap-1.5 px-2.5 text-[12px]",
          board && "mb-1",
        )}
      >
        <span className="min-w-0 truncate">
          {database?.name ?? data.title}
          {board ? " · Board" : ""}
        </span>
      </span>
      {board ? (
        <div className="flex max-h-80 overflow-auto px-0.5 [&>div]:!m-0 [&>div]:!p-0">
          {content}
        </div>
      ) : (
        <div className={insetCardClass}>
          <div className="-mx-3.5 -my-3 flex max-h-80 overflow-auto [&>div]:px-2 [&>div]:pb-2">
            {content}
          </div>
        </div>
      )}
      <span
        className={cn(
          "flex min-h-9 items-center gap-1.5 px-2.5 text-[12px]",
          board ? "pt-2" : "pt-1",
        )}
      >
        <span className="text-muted-foreground min-w-0 flex-1 truncate">
          {state.data
            ? `${state.data.rows.length} ${state.data.rows.length === 1 ? "row" : "rows"}`
            : ""}
        </span>
        <Button size="xs" variant="outline" onClick={open}>
          Open {board ? "board" : "database"} <ArrowUpRight size={12} />
        </Button>
      </span>
    </section>
  );
}
