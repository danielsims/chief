import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";

import { isJsonString } from "@chief/relay-contracts";

import { LocalStore } from "../src/local-store.js";
import {
  localStoreFixture as fixture,
  localStoreTestEncryptionKey,
} from "./local-store-test-fixture.js";

void test("baseline contains only the required singular one-word tables", async () => {
  const { directory, path, store } = fixture("table-names");
  const client = createClient({
    url: `file:${path}`,
    encryptionKey: localStoreTestEncryptionKey,
  });
  try {
    await store.health();
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle_%' ORDER BY name",
    );
    assert.deepEqual(
      result.rows.map((row) => {
        assert.ok(isJsonString(row.name));
        return row.name;
      }),
      [
        "action",
        "audit",
        "binding",
        "browser",
        "campaign",
        "cell_alarm",
        "cell_event",
        "cell_lease",
        "cell_outbox",
        "cell_project_lease",
        "cell_state",
        "channel",
        "checkout",
        "content",
        "dataset",
        "event",
        "file",
        "message",
        "post",
        "preference",
        "project",
        "project_access_request",
        "project_grant",
        "project_operation",
        "project_provider_link",
        "prospect",
        "provider_connection",
        "schedule",
        "session",
        "trend",
        "version",
      ],
    );
    for (const table of [
      "action",
      "browser",
      "campaign",
      "content",
      "dataset",
      "event",
      "file",
      "message",
      "preference",
      "prospect",
      "schedule",
      "session",
      "trend",
      "version",
    ]) {
      const columns = await client.execute(`PRAGMA table_info(${table})`);
      const names = columns.rows.map((row) => row.name);
      assert.ok(
        names.includes("organization_id"),
        `${table} has organization_id`,
      );
      assert.ok(
        !names.includes("workspace_id"),
        `${table} excludes workspace_id`,
      );
    }
    const messageColumns = await client.execute("PRAGMA table_info(message)");
    const messageNames = messageColumns.rows.map((row) => row.name);
    assert.ok(messageNames.includes("session_id"));
    assert.ok(!messageNames.includes("chat_id"));
    assert.ok(messageNames.includes("organization_id"));
    const eventColumns = await client.execute("PRAGMA table_info(event)");
    assert.ok(
      eventColumns.rows.map((row) => row.name).includes("organization_id"),
    );
    for (const table of ["file", "version"]) {
      const columns = await client.execute(`PRAGMA table_info(${table})`);
      const names = columns.rows.map((row) => row.name);
      assert.ok(names.includes("source_session_id"));
      assert.ok(!names.includes("source_run_id"));
    }
  } finally {
    client.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("an interrupted additive channel migration resumes without data loss", async () => {
  const {
    directory,
    path,
    store: initialStore,
  } = fixture("interrupted-channel-migration");
  let store = initialStore;
  try {
    await store.createChat({
      id: "preserved-chat",
      organizationId: "workspace",
      visibility: "user",
      agent: "general",
      provider: "codex",
    });
    await store.close();

    const client = createClient({
      url: `file:${path}`,
      encryptionKey: localStoreTestEncryptionKey,
    });
    await client.execute("DROP TABLE audit");
    await client.execute("ALTER TABLE channel DROP COLUMN workstream");
    client.close();

    store = new LocalStore(path);
    await store.health();
    assert.ok(await store.chatRecord("workspace", "preserved-chat"));

    const repairedClient = createClient({
      url: `file:${path}`,
      encryptionKey: localStoreTestEncryptionKey,
    });
    const channelColumns = await repairedClient.execute(
      "PRAGMA table_info(channel)",
    );
    const channelColumnNames = channelColumns.rows.map((row) => row.name);
    for (const name of [
      "visibility",
      "kind",
      "lifecycle",
      "archived_at",
      "created_by",
      "agent_permissions",
      "workstream",
      "operation_key",
      "version",
    ]) {
      assert.ok(channelColumnNames.includes(name), `channel.${name}`);
    }
    for (const [table, expected] of [
      [
        "schedule",
        ["trigger", "operation_key", "version", "webhook_secret_hash"],
      ],
      ["session", ["trigger_context"]],
      ["audit", ["sequence", "previous_hash", "hash"]],
      ["preference", ["tool_permissions"]],
    ] as const) {
      const columns = await repairedClient.execute(
        `PRAGMA table_info(${table})`,
      );
      const names = columns.rows.map((row) => row.name);
      for (const name of expected) {
        assert.ok(names.includes(name), `${table}.${name}`);
      }
    }
    const audit = await repairedClient.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'audit'",
    );
    assert.equal(audit.rows.length, 1);
    repairedClient.close();
  } finally {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

void test("an obsolete pre-release baseline is replaced on startup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "chief-obsolete-baseline-"));
  const path = join(directory, "chief.sqlite");
  const obsoleteClient = createClient({
    url: `file:${path}`,
    encryptionKey: localStoreTestEncryptionKey,
  });
  await obsoleteClient.execute(
    "CREATE TABLE preference (organization_id text NOT NULL)",
  );
  obsoleteClient.close();

  const store = new LocalStore(path);
  let client: ReturnType<typeof createClient> | undefined;
  try {
    await store.health();
    client = createClient({
      url: `file:${path}`,
      encryptionKey: localStoreTestEncryptionKey,
    });
    const columns = await client.execute("PRAGMA table_info(message)");
    assert.ok(columns.rows.map((row) => row.name).includes("organization_id"));
  } finally {
    client?.close();
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
