import { z } from "zod";

import { commandEnvelopeSchema } from "./envelopes";
import {
  agentIdSchema,
  conversationIdSchema,
  isoDateTimeSchema,
  userIdSchema,
  workspaceIdSchema,
} from "./identifiers";

/** A channel record as stored by the workspace object. */
export const channelRecordSchema = z
  .object({
    id: conversationIdSchema,
    workspaceId: workspaceIdSchema,
    name: z.string().trim().min(1).max(120),
    isPrivate: z.boolean(),
    archived: z.boolean(),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const channelListResultSchema = z
  .object({ channels: z.array(channelRecordSchema) })
  .strict();

export const channelCreateCommandSchema = commandEnvelopeSchema(
  z
    .object({
      conversationId: conversationIdSchema,
      name: z.string().trim().min(1).max(120),
      isPrivate: z.boolean().default(false),
    })
    .strict(),
);

export const channelUpdateCommandSchema = commandEnvelopeSchema(
  z
    .object({
      conversationId: conversationIdSchema,
      name: z.string().trim().min(1).max(120).optional(),
      isPrivate: z.boolean().optional(),
    })
    .strict(),
);

export const channelArchiveCommandSchema = commandEnvelopeSchema(
  z.object({ conversationId: conversationIdSchema }).strict(),
);

export const channelUnarchiveCommandSchema = commandEnvelopeSchema(
  z.object({ conversationId: conversationIdSchema }).strict(),
);

export const channelJoinCommandSchema = commandEnvelopeSchema(
  z.object({ conversationId: conversationIdSchema }).strict(),
);

export const channelLeaveCommandSchema = commandEnvelopeSchema(
  z.object({ conversationId: conversationIdSchema }).strict(),
);

export const channelMemberSchema = z
  .object({
    kind: z.enum(["user", "agent"]),
    principalId: z.union([userIdSchema, agentIdSchema]),
    role: z.enum(["owner", "admin", "member"]),
    joinedAt: isoDateTimeSchema,
    name: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const channelDetailSchema = z
  .object({
    channel: channelRecordSchema,
    members: z.array(channelMemberSchema),
  })
  .strict();

export const channelActionResultSchema = z
  .object({ ok: z.literal(true) })
  .strict();

export const channelMembersResultSchema = z
  .object({ members: z.array(channelMemberSchema) })
  .strict();

export const channelMembershipSchema = channelMemberSchema
  .extend({ conversationId: conversationIdSchema })
  .strict();

export const channelMembershipsResultSchema = z
  .object({ memberships: z.array(channelMembershipSchema) })
  .strict();

export const channelMemberAddCommandSchema = commandEnvelopeSchema(
  z.union([
    z
      .object({
        conversationId: conversationIdSchema,
        kind: z.enum(["user", "agent"]),
        principalId: z.union([userIdSchema, agentIdSchema]),
      })
      .strict(),
    z
      .object({
        conversationId: conversationIdSchema,
        members: z
          .array(
            z
              .object({
                kind: z.enum(["user", "agent"]),
                principalId: z.union([userIdSchema, agentIdSchema]),
              })
              .strict(),
          )
          .min(1)
          .max(32),
      })
      .strict(),
  ]),
);

export const channelMemberRemoveCommandSchema = commandEnvelopeSchema(
  z
    .object({
      conversationId: conversationIdSchema,
      kind: z.enum(["user", "agent"]),
      principalId: z.union([userIdSchema, agentIdSchema]),
    })
    .strict(),
);

export type ChannelRecord = z.infer<typeof channelRecordSchema>;
export type ChannelMember = z.infer<typeof channelMemberSchema>;
export type ChannelMembership = z.infer<typeof channelMembershipSchema>;
export type ChannelDetail = z.infer<typeof channelDetailSchema>;
export type ChannelCreateCommand = z.infer<typeof channelCreateCommandSchema>;
export type ChannelUpdateCommand = z.infer<typeof channelUpdateCommandSchema>;
export type ChannelMemberAddCommand = z.infer<
  typeof channelMemberAddCommandSchema
>;
export type ChannelMemberRemoveCommand = z.infer<
  typeof channelMemberRemoveCommandSchema
>;
