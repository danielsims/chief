import { addChannelMembersTool } from "../../runtime/channels/add-channel-members.js";
import { createChannelTool } from "../../runtime/channels/create-channel.js";
import { listChannelMembersTool } from "../../runtime/channels/list-channel-members.js";
import { listChannelsTool } from "../../runtime/channels/list-channels.js";
import { archiveChannelTool } from "./archive-channel.js";
import { getChannelTool } from "./get-channel.js";
import { joinChannelTool } from "./join-channel.js";
import { leaveChannelTool } from "./leave-channel.js";
import { listChannelActivityTool } from "./list-channel-activity.js";
import { channelMessagesToolkit } from "./messages/index.js";
import { removeChannelMemberTool } from "./remove-channel-member.js";
import { requestChannelDeletionTool } from "./request-channel-deletion.js";
import { unarchiveChannelTool } from "./unarchive-channel.js";
import { updateChannelTool } from "./update-channel.js";

export const channelsToolkit = [
  listChannelsTool,
  createChannelTool,
  getChannelTool,
  updateChannelTool,
  archiveChannelTool,
  unarchiveChannelTool,
  joinChannelTool,
  leaveChannelTool,
  listChannelMembersTool,
  addChannelMembersTool,
  removeChannelMemberTool,
  listChannelActivityTool,
  requestChannelDeletionTool,
  ...channelMessagesToolkit,
] as const;
