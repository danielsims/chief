import type { ReactNode } from "react";
import type {
  AgentCapabilityId,
  ContentBlock,
} from "@chief/agent-runtime/types";

export interface GenerativePartRenderer {
  capability?: AgentCapabilityId;
  partType: ContentBlock["type"];
  render: (part: ContentBlock) => ReactNode | undefined;
}

export interface GenerativePartModule {
  default: GenerativePartRenderer;
}
