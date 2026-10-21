import type { DatabaseRowSave, DatabaseSave } from "@chief/relay-contracts";
import {
  databaseDeleteResultSchema,
  databaseListSchema,
  databaseRowSchema,
  databaseSchema,
  databaseWithRowsSchema,
} from "@chief/relay-contracts";

import type { RelayClientOptions } from "./relay-client-options";
import { RelayClientBase } from "./relay-client-base";

/** Databases, such as boards: typed rows that live in a channel. */
export class RelayDatabasesClient extends RelayClientBase {
  constructor(options: RelayClientOptions) {
    super(options);
  }

  async list(conversationId?: string) {
    const query = conversationId
      ? `?conversationId=${encodeURIComponent(conversationId)}`
      : "";
    return (
      await this.fetchJson(
        this.workspaceUrl(`databases${query}`),
        databaseListSchema,
      )
    ).databases;
  }

  get(databaseId: string) {
    return this.fetchJson(this.databaseUrl(databaseId), databaseWithRowsSchema);
  }

  save(input: DatabaseSave) {
    return this.fetchJson(
      this.workspaceUrl("databases"),
      databaseSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }

  remove(databaseId: string) {
    return this.fetchJson(
      this.databaseUrl(databaseId),
      databaseDeleteResultSchema,
      true,
      { method: "DELETE" },
    );
  }

  saveRow(databaseId: string, input: DatabaseRowSave) {
    return this.fetchJson(
      `${this.databaseUrl(databaseId)}/rows`,
      databaseRowSchema,
      true,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      },
    );
  }

  removeRow(databaseId: string, rowId: string) {
    return this.fetchJson(
      `${this.databaseUrl(databaseId)}/rows/${encodeURIComponent(rowId)}`,
      databaseDeleteResultSchema,
      true,
      { method: "DELETE" },
    );
  }

  private databaseUrl(databaseId: string) {
    return this.workspaceUrl(`databases/${encodeURIComponent(databaseId)}`);
  }
}
