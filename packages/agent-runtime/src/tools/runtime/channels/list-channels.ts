import { defineLocalTool } from "../../tool.js";
import { executeChannelTool } from "../../toolkits/channels/execute.js";
import { listChannelsDefinition } from "../../toolkits/channels/list-channels.js";

export const listChannelsTool = defineLocalTool({
  ...listChannelsDefinition,
  execute: executeChannelTool,
});
