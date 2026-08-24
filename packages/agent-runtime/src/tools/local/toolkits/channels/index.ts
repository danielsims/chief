import { addChannelMembersTool } from "./add-channel-members.js";
import { archiveChannelTool } from "./archive-channel.js";
import { createChannelTool } from "./create-channel.js";
import { getChannelTool } from "./get-channel.js";
import { joinChannelTool } from "./join-channel.js";
import { leaveChannelTool } from "./leave-channel.js";
import { listChannelActivityTool } from "./list-channel-activity.js";
import { listChannelMembersTool } from "./list-channel-members.js";
import { listChannelsTool } from "./list-channels.js";
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
