import { z } from "zod";

import type { ChiefUIMessage } from "@chief/agent-runtime/types";

/** A page an agent read while answering. */
export interface MessageSource {
  url: string;
  title: string;
}

const webUrlSchema = z
  .url()
  .refine((url) => url.startsWith("https://") || url.startsWith("http://"));

const pageObjectSchema = z.object({
  url: webUrlSchema,
  title: z.string().default(""),
});

/** What a page read returns: the page itself, as an object or JSON text. */
const pageSchema = z.union([
  pageObjectSchema,
  z.string().transform((text, context) => {
    try {
      return pageObjectSchema.parse(JSON.parse(text));
    } catch {
      context.addIssue({ code: "custom", message: "Not a page." });
      return z.NEVER;
    }
  }),
]);

const pageInputSchema = z.object({ url: webUrlSchema });

/** Hosted `web.read` and Claude Code's `WebFetch`, however the runtime spells them. */
function readsPage(toolName: string) {
  const name = toolName
    .replace(/^mcp__[^_]+__/u, "")
    .toLocaleLowerCase()
    .replace(/[_-]/gu, ".");
  return name === "web.read" || name === "webfetch" || name === "web.fetch";
}

/** The pages read in one activity message: its finished page reads. */
export function messagePageReads(message: ChiefUIMessage): MessageSource[] {
  return message.parts.flatMap((part) => {
    if (part.type !== "dynamic-tool" || part.state !== "output-available")
      return [];
    if (!readsPage(part.toolName)) return [];
    const page = pageSchema.safeParse(part.output);
    if (page.success)
      return [{ url: page.data.url, title: page.data.title.trim() }];
    const input = pageInputSchema.safeParse(part.input);
    return input.success ? [{ url: input.data.url, title: "" }] : [];
  });
}

/** Adds sources, keeping the first sighting of each page. */
export function mergeSources(
  current: readonly MessageSource[],
  next: readonly MessageSource[],
) {
  const seen = new Set(current.map((source) => source.url));
  return [
    ...current,
    ...next.filter((source) => {
      if (seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    }),
  ];
}
