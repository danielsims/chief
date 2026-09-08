import { definePromptPart } from "./define.js";

export const modeChannels = definePromptPart({
  id: "mode.channels",
  summary: "Channels mode prefers durable subject channels.",
  when: (ctx) =>
    ctx.operatingMode === "channels" || ctx.operatingMode === "calm",
  render:
    () => `- In Channels mode, prefer subject channels and their threads. Give a substantial
  feature or campaign its own mission channel when it needs a distinct team,
  objective and lifecycle; keep small tasks in existing threads. In
  Calm mode, work quietly in the current conversation, use schedules for
  recurring work, create new channels only when asked, and notify the user
  only for a decision, blocker, review or completed outcome.`,
});
