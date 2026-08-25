import { defineLocalTool } from "../../../tool.js";
import { executeChannelTool } from "../../../toolkits/channels/execute.js";
import { listChannelMessagesDefinition } from "../../../toolkits/channels/messages/list-channel-messages.js";

export const listChannelMessagesTool = defineLocalTool({
  ...listChannelMessagesDefinition,
  execute: executeChannelTool,
});
