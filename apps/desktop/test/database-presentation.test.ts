import assert from "node:assert/strict";
import test from "node:test";

import {
  canDeleteDatabase,
  databaseSchema,
  workspaceBoardId,
} from "@chief/relay-contracts";

import {
  canonicalChannelTab,
  uniqueChannelTabs,
} from "../src/components/chat/channel-tab-identity";
import {
  databaseViews,
  selectedDatabaseView,
} from "../src/components/databases/database-presentation";

const database = databaseSchema.parse({
  id: "07d9ae5d-53f6-52d9-ae0b-73d80ccc590d",
  name: "Prospects",
  channels: [],
  fields: [{ id: "title", name: "Company", type: "title" }],
  views: [
    { id: "table", name: "Prospects", layout: "table" },
    { id: "board", name: "Board", layout: "board" },
  ],
  createdAt: 1,
  updatedAt: 1,
});
const wrapper = {
  id: "old-page",
  previewContent: JSON.stringify({
    sources: { records: { database: database.id } },
    spec: {
      root: "board",
      elements: {
        board: { type: "Board", props: { source: "records" }, children: [] },
      },
    },
  }),
};

void test("board opens by default regardless of stored view order; table selection uses the same view object", () => {
  const views = databaseViews(database);
  assert.deepEqual(
    views.map((view) => view.id),
    database.views.map((view) => view.id),
  );
  assert.equal(selectedDatabaseView(views)?.layout, "board");
  assert.equal(selectedDatabaseView(views, "table")?.id, database.views[0]?.id);
  assert.equal(selectedDatabaseView(views, "removed-view")?.layout, "board");
});
void test("duplicate layouts collapse to Board and Database and removed views stay removed", () => {
  const views = databaseViews({
    views: [
      ...database.views,
      { id: "duplicate_table", name: "Table", layout: "table" },
      {
        id: "duplicate_board",
        name: "Board",
        layout: "board",
        groupBy: "status",
      },
    ],
  });
  assert.equal(views.length, 2);
  assert.deepEqual(
    views.map((view) => view.name),
    ["Database", "Board"],
  );
  const boardOnly = databaseViews({
    views: database.views.filter((view) => view.layout === "board"),
  });
  assert.equal(boardOnly.length, 1);
  assert.equal(selectedDatabaseView(boardOnly)?.layout, "board");
});
void test("legacy board pages and their database collapse to one canonical tab", () => {
  const tabs = uniqueChannelTabs(
    [
      { kind: "file", id: wrapper.id, name: "Old board" },
      { kind: "database", id: database.id },
      { kind: "file", id: "document" },
    ],
    [wrapper],
    [database],
    true,
  );
  assert.deepEqual(tabs, [
    { kind: "database", id: database.id, name: database.name },
    { kind: "file", id: "document" },
  ]);
  assert.deepEqual(
    canonicalChannelTab(
      { kind: "file", id: wrapper.id },
      [wrapper],
      [database],
    ),
    tabs[0],
  );
});
void test("deleted databases and their legacy board aliases disappear, while ordinary files stay", () => {
  const tabs = [
    { kind: "database" as const, id: database.id },
    { kind: "file" as const, id: wrapper.id },
    { kind: "file" as const, id: "document" },
  ];
  assert.deepEqual(uniqueChannelTabs(tabs, [wrapper], [], true), [
    { kind: "file", id: "document" },
  ]);
  assert.equal(uniqueChannelTabs(tabs, [wrapper], [], false).length, 2);
});

void test("delete controls match the owner-or-human-creator policy and deny unknown roles", () => {
  const owned = databaseSchema.parse({
    ...database,
    createdBy: { kind: "user", id: "creator" },
  });
  assert.equal(
    canDeleteDatabase(owned, { userId: "other", role: "owner" }),
    true,
  );
  assert.equal(
    canDeleteDatabase(owned, { userId: "creator", role: "member" }),
    true,
  );
  assert.equal(
    canDeleteDatabase(owned, { userId: "other", role: "admin" }),
    false,
  );
  assert.equal(
    canDeleteDatabase(owned, { userId: "other", role: "member" }),
    false,
  );
  assert.equal(canDeleteDatabase(owned, null), false);
  assert.equal(
    canDeleteDatabase(
      { ...owned, id: workspaceBoardId },
      { userId: "creator", role: "owner" },
    ),
    false,
  );
});

void test("cold file metadata never flashes a second board tab before its identity resolves", () => {
  const tabs = [
    { kind: "database" as const, id: database.id, name: database.name },
    { kind: "file" as const, id: wrapper.id, name: "Old board" },
  ];
  const cold = uniqueChannelTabs(tabs, [], [database], true, false);
  const ready = uniqueChannelTabs(tabs, [wrapper], [database], true, true);
  assert.deepEqual(cold, ready);
  assert.equal(cold.length, 1);
});
