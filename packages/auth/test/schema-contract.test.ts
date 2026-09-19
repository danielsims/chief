import assert from "node:assert/strict";
import test from "node:test";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";

import { authSchemaContract } from "../src/schema/contract";
import * as sqliteSchema from "../src/schema/sqlite";
import { oauthClient } from "../src/schema/sqlite/oauth.js";

void test("the D1 schema implements every canonical auth model", () => {
  const actual = Object.fromEntries(
    Object.entries(sqliteSchema).map(([model, schema]) => [
      model,
      {
        table: getTableName(schema),
        fields: Object.keys(getTableColumns(schema)).sort(),
      },
    ]),
  );

  assert.deepEqual(actual, authSchemaContract);
  assert.deepEqual(
    Object.keys(sqliteSchema).sort(),
    Object.keys(actual).sort(),
  );
});

void test("oauth clients cascade when a user is deleted", () => {
  const { foreignKeys } = getTableConfig(oauthClient);
  assert.equal(
    foreignKeys.some((key) => {
      const reference = key.reference();
      return (
        reference.columns.some((column) => column.name === "user_id") &&
        key.onDelete === "cascade"
      );
    }),
    true,
  );
});
