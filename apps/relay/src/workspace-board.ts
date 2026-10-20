import { z } from "zod";

import type {
  BoardAssignee,
  BoardItemSource,
  BoardLane,
  Principal,
} from "@chief/relay-contracts";
import {
  boardItemSaveSchema,
  boardItemSchema,
  boardLaneSchema,
  boardLanesInputSchema,
  boardSchema,
  defaultBoardLanes,
} from "@chief/relay-contracts";

import type { WorkspaceChannelStore } from "./workspace-channel-store";
import { HttpError, json, parseJson } from "./http";
import { boardItemsDeleteItem } from "./queries/board-items/delete-item";
import { boardItemsFindListItems } from "./queries/board-items/find-list-items";
import { boardItemsUpsertItem } from "./queries/board-items/upsert-item";
import { boardLanesFindGetLanes } from "./queries/board-lanes/find-get-lanes";
import { boardLanesUpsertLanes } from "./queries/board-lanes/upsert-lanes";
import { readWorkspaceSchedule } from "./workspace-schedule-store";

/**
 * The workspace board: the work people and agents are tracking, by where it
 * stands. An item that came from a channel or automation is only seen by
 * those who can read that channel; anything else is shared workspace-wide.
 */
const boardId = "workspace";
const maximumItems = 500;

/** Items remember the channel that decides who sees them. */
const storedItemSchema = boardItemSchema.extend({
  channelId: z.string().min(1).max(160).optional(),
});
type StoredItem = z.infer<typeof storedItemSchema>;

const notFound = () =>
  new HttpError(404, "board_item_not_found", "Board item not found.");

function readLanes(storage: DurableObjectStorage): BoardLane[] {
  const row = boardLanesFindGetLanes<{ lanes_json: string }>(
    storage,
    boardId,
  )[0];
  if (!row) return [...defaultBoardLanes];
  const lanes = z.array(boardLaneSchema).safeParse(JSON.parse(row.lanes_json));
  return lanes.success && lanes.data.length
    ? lanes.data
    : [...defaultBoardLanes];
}

function readItems(storage: DurableObjectStorage) {
  return boardItemsFindListItems<{ item_json: string }>(storage).flatMap(
    (row) => {
      const item = storedItemSchema.safeParse(JSON.parse(row.item_json));
      return item.success ? [item.data] : [];
    },
  );
}

function writeItem(storage: DurableObjectStorage, item: StoredItem) {
  boardItemsUpsertItem(storage, {
    itemId: item.id,
    itemJson: JSON.stringify(storedItemSchema.parse(item)),
    updatedAt: item.updatedAt,
  });
}

function present(items: StoredItem[], lanes: BoardLane[]) {
  return boardSchema.parse({
    lanes,
    items: [...items]
      .sort((left, right) => left.position - right.position)
      .map(({ channelId: _channelId, ...item }) => item),
  });
}

/** The top of a lane, so new and moved items are seen first. */
function topOf(items: StoredItem[], lane: string) {
  const positions = items
    .filter((item) => item.lane === lane)
    .map((item) => item.position);
  return positions.length ? Math.min(...positions) - 1 : 0;
}

export async function routeWorkspaceBoard(
  storage: DurableObjectStorage,
  request: Request,
  operation: string,
  principal: Principal,
  channels: WorkspaceChannelStore,
) {
  if (principal.kind !== "user" && principal.kind !== "agent")
    throw new HttpError(
      403,
      "board_access_denied",
      "Only workspace members can use the board.",
    );
  const canRead = (conversationId: string) =>
    channels.canReadConversation(conversationId, principal);
  const visible = (item: StoredItem) =>
    !item.channelId || canRead(item.channelId);
  /** The channel behind a source, refusing one the caller cannot read. */
  const channelOf = (source: BoardItemSource) => {
    const conversationId =
      source.kind === "thread"
        ? source.conversationId
        : readWorkspaceSchedule(storage, source.scheduleId)?.schedule
            .conversationId;
    if (!conversationId || !canRead(conversationId))
      throw new HttpError(
        404,
        "board_source_not_found",
        source.kind === "thread"
          ? "Conversation not found."
          : "Automation not found.",
      );
    return conversationId;
  };

  if (operation === "data-board-list") {
    return json(
      present(readItems(storage).filter(visible), readLanes(storage)),
    );
  }

  if (operation === "data-board-delete") {
    const id = z.uuid().safeParse(request.headers.get("x-chief-board-item-id"));
    const item = id.success
      ? readItems(storage).find((candidate) => candidate.id === id.data)
      : undefined;
    if (!item || !visible(item)) throw notFound();
    boardItemsDeleteItem(storage, item.id);
    return json({ deleted: true });
  }

  if (operation === "data-board-lanes") {
    // Lanes shape everyone's board, so people set them, not agents.
    if (principal.kind !== "user")
      throw new HttpError(
        403,
        "board_lanes_denied",
        "Only people can change the board's lanes.",
      );
    const { lanes } = boardLanesInputSchema.parse(await parseJson(request));
    const now = Date.now();
    const kept = new Set(lanes.map((lane) => lane.id));
    const first = lanes[0]?.id ?? "";
    storage.transactionSync(() => {
      boardLanesUpsertLanes(storage, {
        boardId,
        lanesJson: JSON.stringify(lanes),
        updatedAt: now,
      });
      // Items in a removed lane move to the bottom of the first lane.
      const items = readItems(storage);
      let position = Math.max(
        0,
        ...items
          .filter((item) => item.lane === first)
          .map((item) => item.position),
      );
      for (const item of items)
        if (!kept.has(item.lane))
          writeItem(storage, {
            ...item,
            lane: first,
            position: (position += 1),
            updatedAt: now,
          });
    });
    return json(present(readItems(storage).filter(visible), lanes));
  }

  if (operation !== "data-board-save") return undefined;
  const input = boardItemSaveSchema.parse(await parseJson(request));
  const items = readItems(storage);
  const current = input.id
    ? items.find((item) => item.id === input.id)
    : undefined;
  // A hidden item answers as missing, so its existence isn't revealed.
  if (current && !visible(current)) throw notFound();
  if (!current && !input.title)
    throw new HttpError(400, "board_item_invalid", "A new item needs a title.");
  if (!current && items.length >= maximumItems)
    throw new HttpError(
      409,
      "board_full",
      "The board has 500 items. Remove finished ones before adding more.",
    );
  const lanes = readLanes(storage);
  const lane = input.lane ?? current?.lane ?? lanes[0]?.id ?? "backlog";
  if (!lanes.some((candidate) => candidate.id === lane))
    throw new HttpError(400, "board_lane_unknown", "That lane doesn't exist.");
  const source =
    input.source === undefined ? current?.source : (input.source ?? undefined);
  const channelId =
    input.source === undefined
      ? current?.channelId
      : source
        ? channelOf(source)
        : undefined;
  const assignee: BoardAssignee | undefined =
    input.assignee === null
      ? undefined
      : (input.assignee ??
        current?.assignee ??
        (!current && principal.kind === "agent"
          ? { kind: "agent", id: principal.agentId }
          : undefined));
  if (
    assignee &&
    (assignee.kind !== current?.assignee?.kind ||
      assignee.id !== current.assignee.id)
  )
    channels.requireWorkspaceMember(assignee.kind, assignee.id);
  const now = Date.now();
  const item: StoredItem = {
    id: current?.id ?? input.id ?? crypto.randomUUID(),
    title: input.title ?? current?.title ?? "",
    notes: input.notes ?? current?.notes ?? "",
    lane,
    position:
      input.position ??
      (current?.lane === lane ? current.position : topOf(items, lane)),
    ...(assignee ? { assignee } : undefined),
    ...(source ? { source } : undefined),
    ...(channelId ? { channelId } : undefined),
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  writeItem(storage, item);
  return json(present([item], lanes).items[0]);
}
