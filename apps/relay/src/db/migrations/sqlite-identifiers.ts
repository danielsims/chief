/** Migration identifiers are code-owned; never accept SQL fragments as names. */
export function sqliteIdentifier(name: string) {
  if (!/^[a-z][a-z0-9_]*$/u.test(name)) {
    throw new Error("Invalid SQLite migration identifier.");
  }
  return `"${name}"`;
}

export type AdditiveColumnDefinition =
  | "TEXT"
  | "TEXT NOT NULL DEFAULT ''"
  | "TEXT NOT NULL DEFAULT 'pending_setup'"
  | "TEXT NOT NULL DEFAULT 'channel'"
  | "TEXT NOT NULL DEFAULT 'user'"
  | "INTEGER NOT NULL DEFAULT 0"
  | "INTEGER NOT NULL DEFAULT 1";
