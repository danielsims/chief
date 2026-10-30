import { expect, it } from "vitest";
import { z } from "zod";

import type { JsonObject } from "@chief/relay-contracts";
import {
  databaseSchema,
  userPrincipalSchema,
  workspaceBoardId,
} from "@chief/relay-contracts";

import { WorkspaceChannelStore } from "../src/workspace-channel-store";
import { routeWorkspaceDatabases } from "../src/workspace-databases";
import { relayTestEnv } from "./helpers";
import { withWorkspaceStorage } from "./sqlite-test-storage";

const principal = (
  userId: string,
  role: "owner" | "admin" | "member" = "member",
) =>
  userPrincipalSchema.parse({
    kind: "user",
    userId,
    role,
    workspaceId: "workspace-test",
    pubkey: "a".repeat(64),
  });
const request = (id?: string, body?: JsonObject) => {
  const headers = new Headers({ "content-type": "application/json" });
  if (id) headers.set("x-chief-database-id", id);
  return new Request("https://workspace.internal/databases", {
    method: body ? "POST" : "DELETE",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
};

it("only current workspace owners and the immutable creator can delete a database", async () =>
  withWorkspaceStorage(async (storage) => {
    const channels = new WorkspaceChannelStore(storage, relayTestEnv());
    for (const [user, role] of [
      ["creator", "member"],
      ["other", "member"],
      ["admin", "admin"],
      ["owner", "owner"],
    ] as const)
      storage.sql.exec(
        "INSERT INTO members (principal_kind,principal_id,role,created_at) VALUES ('user',?,?,?)",
        user,
        role,
        new Date().toISOString(),
      );
    for (const layout of ["table", "board"]) {
      await expect(
        routeWorkspaceDatabases(
          storage,
          request(undefined, {
            name: "Duplicate views",
            fields: [
              { id: "title", name: "Title", type: "title" },
              { id: "status", name: "Status", type: "select", options: [] },
            ],
            views: [
              {
                id: "first",
                name: "First",
                layout,
                ...(layout === "board" ? { groupBy: "status" } : undefined),
              },
              {
                id: "second",
                name: "Second",
                layout,
                ...(layout === "board" ? { groupBy: "status" } : undefined),
              },
            ],
          }),
          "data-database-save",
          principal("creator"),
          channels,
        ),
      ).rejects.toMatchObject({ status: 400, code: "database_invalid" });
    }
    const created = await routeWorkspaceDatabases(
      storage,
      request(undefined, { name: "Test" }),
      "data-database-save",
      principal("creator"),
      channels,
    );
    const database = databaseSchema.parse(await created?.json());
    expect(database.createdBy).toEqual({ kind: "user", id: "creator" });
    const edited = await routeWorkspaceDatabases(
      storage,
      request(undefined, { id: database.id, name: "Renamed" }),
      "data-database-save",
      principal("other"),
      channels,
    );
    expect(databaseSchema.parse(await edited?.json()).createdBy).toEqual({
      kind: "user",
      id: "creator",
    });
    await expect(
      routeWorkspaceDatabases(
        storage,
        request(undefined, {
          id: database.id,
          createdBy: { kind: "user", id: "other" },
        }),
        "data-database-save",
        principal("other"),
        channels,
      ),
    ).rejects.toBeDefined();
    for (const user of ["other", "admin"])
      await expect(
        routeWorkspaceDatabases(
          storage,
          request(database.id),
          "data-database-delete",
          principal(user, "owner"),
          channels,
        ),
      ).rejects.toMatchObject({ status: 403, code: "database_delete_denied" });
    expect(
      storage.sql
        .exec(
          "SELECT database_id FROM databases WHERE database_id = ?",
          database.id,
        )
        .toArray(),
    ).toHaveLength(1);
    expect(
      (
        await routeWorkspaceDatabases(
          storage,
          request(database.id),
          "data-database-delete",
          principal("creator"),
          channels,
        )
      )?.status,
    ).toBe(200);
    const another = await routeWorkspaceDatabases(
      storage,
      request(undefined, { name: "Owner deletion" }),
      "data-database-save",
      principal("creator"),
      channels,
    );
    const anotherId = databaseSchema.parse(await another?.json()).id;
    storage.sql.exec("DELETE FROM members WHERE principal_id = ?", "creator");
    await expect(
      routeWorkspaceDatabases(
        storage,
        request(anotherId),
        "data-database-delete",
        principal("creator"),
        channels,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (
        await routeWorkspaceDatabases(
          storage,
          request(anotherId),
          "data-database-delete",
          principal("owner"),
          channels,
        )
      )?.status,
    ).toBe(200);
    await expect(
      routeWorkspaceDatabases(
        storage,
        request(workspaceBoardId),
        "data-database-delete",
        principal("owner"),
        channels,
      ),
    ).rejects.toMatchObject({ status: 409, code: "database_required" });
  }));

it("repairs duplicate views left behind by older saves when they are read", async () =>
  withWorkspaceStorage(async (storage) => {
    const channels = new WorkspaceChannelStore(storage, relayTestEnv());
    const created = await routeWorkspaceDatabases(
      storage,
      request(undefined, {
        name: "Legacy duplicate",
        fields: [
          { id: "title", name: "Title", type: "title" },
          { id: "status", name: "Status", type: "select", options: [] },
        ],
        views: [
          { id: "board", name: "Board", layout: "board", groupBy: "status" },
          { id: "table", name: "Database", layout: "table" },
        ],
      }),
      "data-database-save",
      principal("owner", "owner"),
      channels,
    );
    const database = databaseSchema.parse(await created?.json());
    storage.sql.exec(
      "UPDATE databases SET database_json = ? WHERE database_id = ?",
      JSON.stringify({
        ...database,
        views: [
          ...database.views,
          { id: "legacy", name: "Table", layout: "table" },
        ],
      }),
      database.id,
    );
    const listed = await routeWorkspaceDatabases(
      storage,
      new Request("https://workspace.internal/databases", { method: "GET" }),
      "data-databases-list",
      principal("owner", "owner"),
      channels,
    );
    const repaired = z
      .object({ databases: databaseSchema.array() })
      .parse(await listed?.json())
      .databases.find((candidate) => candidate.id === database.id);
    expect(repaired?.views.map((view) => view.layout)).toEqual([
      "board",
      "table",
    ]);
    const stored = databaseSchema.parse(
      JSON.parse(
        storage.sql
          .exec(
            "SELECT database_json FROM databases WHERE database_id = ?",
            database.id,
          )
          .one().database_json as string,
      ),
    );
    expect(stored.views).toHaveLength(2);
  }));
