import { defineAgentTool } from "../../definition.js";

export const listChannelMembersDefinition = defineAgentTool({
  method: "GET",
  path: "/local-tools/channels/{channelId}/members",
  operation: {
    operationId: "channels.members.list",
    summary: "List channel members",
  },
});
