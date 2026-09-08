import { defineLocalTool } from "../../tool.js";
import { executeChannelTool } from "../../toolkits/channels/execute.js";
import { joinChannelDefinition } from "../../toolkits/channels/join-channel.js";

export const joinChannelTool = defineLocalTool({
  ...joinChannelDefinition,
  execute: (request) => executeChannelTool(request, request.input),
});
