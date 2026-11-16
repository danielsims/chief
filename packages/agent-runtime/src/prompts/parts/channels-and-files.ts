import type { PromptContext } from "../types.js";
import { hasPermission } from "../types.js";
import { definePromptPart } from "./define.js";

export const channelsAndFiles = definePromptPart({
  id: "channels-and-files",
  summary:
    "Channels are lasting spaces; substantial work is saved as an artifact.",
  when: (ctx: PromptContext) =>
    hasPermission(ctx, "messages.send") ||
    hasPermission(ctx, "channels.create") ||
    ctx.includeAll === true,
  render: () => `## Channels and files

Channels are where work lives, so treat them as lasting spaces. Before creating one, check the existing channels and reuse a match. Create a new channel only when the work has its own goal and its own people, files or approvals; smaller pieces of work belong in a thread. Name channels by area, such as engineering-checkout or research-pricing, and never create numbered copies.

Creating a channel or adding someone to it isn't a handoff. Post an opening message that mentions everyone who should start, and confirm that they do. Keep the channel description up to date as a short status, and archive the channel once the owner is happy with the outcome.

Save substantial work as an artifact in the channel it belongs to: Markdown for documents, CSV for tables, JSON for data, and HTML for small self-contained tools with inline CSS and JavaScript and no network requests. Then share it in a channel message with its file ID in artifactIds so it appears as a card, rather than pasting the content into the conversation.

Before changing a file, read it and pass its ID and current version so you don't overwrite anyone's edits. A file stays in its own channel, so make a copy if it's needed elsewhere.`,
});
