import type {
  ChannelActorIdentity,
  ChannelWorkstream,
} from "@chief/channel-api";

export interface ChannelUpdateInput {
  name?: string;
  topic?: string;
  description?: string;
  visibility?: "public" | "private";
  workstream?: ChannelWorkstream;
  expectedVersion?: number;
  actor?: ChannelActorIdentity;
}
