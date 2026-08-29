import { defineLocalTool } from "../../tool.js";
import { createChannelDefinition } from "../../toolkits/channels/create-channel.js";
import { executeChannelTool } from "../../toolkits/channels/execute.js";

export const createChannelTool = defineLocalTool({
  ...createChannelDefinition,
  execute: (request) => executeChannelTool(request, request.input),
});
