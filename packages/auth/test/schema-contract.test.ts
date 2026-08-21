import assert from "node:assert/strict";
import test from "node:test";
import { getTableColumns, getTableName } from "drizzle-orm";

import { authSchemaContract } from "../src/schema/contract";
import * as sqliteSchema from "../src/schema/sqlite";

void test("the D1 schema implements every canonical auth model", () => {
  const actual = Object.fromEntries(
    Object.keys(authSchemaContract).map((model) => [
      model,
      {
        table: getTableName(sqliteSchema[model as keyof typeof sqliteSchema]),
        fields: Object.keys(
          getTableColumns(sqliteSchema[model as keyof typeof sqliteSchema]),
        ).sort(),
      },
    ]),
  );

  assert.deepEqual(actual, authSchemaContract);
  assert.deepEqual(
    Object.keys(sqliteSchema).sort(),
    Object.keys(actual).sort(),
  );
});
