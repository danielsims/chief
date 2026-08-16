import type { SetupSkill } from "./setup-skills.js";
import type { MessageAttachment } from "./types.js";

export function sendMessagePromptContext(input: {
  attachments?: MessageAttachment[];
  channelCoordinates?: string;
  mentions?: string[];
  publicationInstructions?: string;
  setupSkill?: SetupSkill;
  threadRootId?: string;
}) {
  const privateInstructions = [
    input.setupSkill
      ? `Setup skill ${input.setupSkill.id}:\n${input.setupSkill.instructions}`
      : undefined,
    input.publicationInstructions,
    input.channelCoordinates,
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    attachments: input.attachments,
    mentions: input.mentions,
    threadRootId: input.threadRootId,
    privateInstructions: privateInstructions || undefined,
  };
}
