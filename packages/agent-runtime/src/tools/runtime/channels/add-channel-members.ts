import { defineLocalTool } from "../../tool.js";
import { addChannelMembersDefinition } from "../../toolkits/channels/add-channel-members.js";
import { executeChannelTool } from "../../toolkits/channels/execute.js";

export const addChannelMembersTool = defineLocalTool({
  ...addChannelMembersDefinition,
  execute: (request) => executeChannelTool(request, request.input),
});
