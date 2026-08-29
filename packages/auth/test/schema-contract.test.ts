import assert from "node:assert/strict";
import test from "node:test";
import { getTableColumns, getTableName } from "drizzle-orm";

import { authSchemaContract } from "../src/schema/contract";
import * as sqliteSchema from "../src/schema/sqlite";

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
