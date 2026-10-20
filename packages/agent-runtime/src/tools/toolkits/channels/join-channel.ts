import { defineAgentTool } from "../../definition.js";
import { channelVersionInputSchema } from "./input.js";

export const joinChannelDefinition = defineAgentTool({
  method: "POST",
  path: "/local-tools/channels/{channelId}/join",
  operation: {
    operationId: "channels.join",
    summary: "Join channel",
    description: "Join an active public channel.",
  },
  inputSchema: channelVersionInputSchema,
});
