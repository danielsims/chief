import type { z } from "zod";

import type {
  AppendMessageCommand,
  appendMessageResultSchema,
  ConversationEvent,
  ConversationMessage,
  MessageAuthor,
  Principal,
  reactToMessageResultSchema,
  WorkspaceId,
} from "@chief/relay-contracts";

import type { UpsertActivityInput } from "./conversation-activity-store";

export interface AppendInput {
  command: AppendMessageCommand;
  workspaceId: WorkspaceId;
  author: MessageAuthor;
  actor: Principal;
}

export interface ReactInput {
  messageId: string;
  emoji: string;
  pubkey: string;
  add: boolean;
  actor: Principal;
  workspaceId: WorkspaceId;
  correlationId: string;
}

export interface EditInput {
  messageId: string;
  body: string;
  actor: Principal;
  workspaceId: WorkspaceId;
  correlationId: string;
}

export interface DeleteInput {
  messageId: string;
  actor: Principal;
  workspaceId: WorkspaceId;
  correlationId: string;
}

export interface ConversationStore {
  append(input: AppendInput): z.infer<typeof appendMessageResultSchema> & {
    event: ConversationEvent;
  };
  getMessage(messageId: string): ConversationMessage | null;
  list(after: number, limit: number, query?: string): MessagePage;
  recent(limit: number): MessagePage;
  replies(rootId: string, after: number, limit: number): MessagePage;
  history(
    threadRootId: string | undefined,
    limit: number,
  ): ConversationMessage[];
  react(input: ReactInput): {
    changed: boolean;
    result: z.infer<typeof reactToMessageResultSchema>;
    event: ConversationEvent | null;
  };
  edit(input: EditInput): MessageMutation;
  upsertActivity(input: UpsertActivityInput): {
    created: boolean;
    message: ConversationMessage;
    event: ConversationEvent;
  };
  delete(input: DeleteInput): MessageMutation;
  listEvents(
    after: number,
    limit: number,
  ): {
    events: ConversationEvent[];
    nextSequence: number | null;
  };
}

interface MessagePage {
  messages: ConversationMessage[];
  nextSequence: number | null;
}

interface MessageMutation {
  message: ConversationMessage;
  event: ConversationEvent | null;
}
