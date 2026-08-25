import { listChannelMessagesTool } from "../../../runtime/channels/messages/list-channel-messages.js";
import { postChannelMessageTool } from "../../../runtime/channels/messages/post-channel-message.js";
import { addMessageReactionTool } from "./add-message-reaction.js";
import { deleteChannelMessageTool } from "./delete-channel-message.js";
import { editChannelMessageTool } from "./edit-channel-message.js";
import { getChannelMessageTool } from "./get-channel-message.js";
import { listMessageReactionsTool } from "./list-message-reactions.js";
import { listThreadRepliesTool } from "./list-thread-replies.js";
import { removeMessageReactionTool } from "./remove-message-reaction.js";
import { searchMessagesTool } from "./search-messages.js";

export const channelMessagesToolkit = [
  listChannelMessagesTool,
  postChannelMessageTool,
  getChannelMessageTool,
  editChannelMessageTool,
  deleteChannelMessageTool,
  listThreadRepliesTool,
  listMessageReactionsTool,
  addMessageReactionTool,
  removeMessageReactionTool,
  searchMessagesTool,
] as const;
