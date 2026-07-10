import type { AgentCapability } from "./types.js";

export const contentCalendarCapability: AgentCapability = {
  id: "content-calendar",
  toolName: "localTools.contentSave",
  partType: "workspace-record",
  instructions: `Content drafts and scheduled posts are durable private workspace records stored on this Mac. In Executor, find localTools.contentList and localTools.contentSave with tools.search, then call the exact returned tool path. Use status draft for an unapproved idea, approved after explicit approval, scheduled only with a concrete scheduledFor date/time, and published only when the user or a verified posting tool confirms publication. Never imply that a scheduled record was automatically posted.`,
};
