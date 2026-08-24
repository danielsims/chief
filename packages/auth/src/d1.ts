import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";

import type { ChiefAuthOptions } from "./options";
import * as schema from "./schema/sqlite";
import { createChiefAuth } from "./server";

export function createChiefD1Auth(
  database: D1Database,
  options: ChiefAuthOptions,
) {
  const drizzleDatabase = drizzle(database, { schema });

  return createChiefAuth(
    options,
    drizzleAdapter(drizzleDatabase, {
      provider: "sqlite",
      schema,
    }),
  );
}
