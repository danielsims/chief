import { defineLocalTool } from "../../tool.js";
import { executeChannelTool } from "../../toolkits/channels/execute.js";
import { listChannelMembersDefinition } from "../../toolkits/channels/list-channel-members.js";

export const listChannelMembersTool = defineLocalTool({
  ...listChannelMembersDefinition,
  execute: executeChannelTool,
});
