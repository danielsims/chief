import { defineLocalTool } from "../../../tool.js";
import { executeChannelTool } from "../../../toolkits/channels/execute.js";
import { postChannelMessageDefinition } from "../../../toolkits/channels/messages/post-channel-message.js";

export const postChannelMessageTool = defineLocalTool({
  ...postChannelMessageDefinition,
  execute: (request) => executeChannelTool(request, request.input),
});
