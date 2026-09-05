import type { JsonObject } from "@chief/relay-contracts";

import type { ChannelLocalToolContext } from "./channel-local-tools.js";
import type { ChannelEvent, WorkspaceChannel } from "./channel-types.js";
import { fail } from "./channel-local-tool-input.js";
import { postPluginRecommendation } from "./channel-plugin-recommendation.js";
import { postProjectRecommendation } from "./channel-project-recommendation.js";

export async function handleChannelRecommendationPost(input: {
  tail: string;
  method: string;
  workspaceId: string;
  channel: WorkspaceChannel;
  events: ChannelEvent[];
  body: JsonObject;
  context: ChannelLocalToolContext;
}) {
  if (
    (input.tail !== "plugins/recommend" &&
      input.tail !== "projects/recommend") ||
    input.method !== "POST"
  ) {
    return null;
  }
  if (input.channel.lifecycle === "archived") {
    fail("Restore this channel before posting.", 409, "channel_archived");
  }
  const value =
    input.tail === "plugins/recommend"
      ? await postPluginRecommendation(input)
      : await postProjectRecommendation(input);
  return { handled: true as const, value };
}
