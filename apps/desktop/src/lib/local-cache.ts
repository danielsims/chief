import type { z } from "zod";

/**
 * Small values kept between sessions so a view paints complete on first
 * render instead of filling in as the relay answers. Storage can be full or
 * unavailable; callers then just wait for live data.
 */
export function readLocalCache<Schema extends z.ZodType>(
  key: string,
  schema: Schema,
): z.infer<Schema> | undefined {
  try {
    const parsed = schema.safeParse(
      JSON.parse(window.localStorage.getItem(key) ?? "null"),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function writeLocalCache<Value>(key: string, value: Value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The live value still renders.
  }
}
