import type { ReactNode } from "react";

import type {
  DriverType,
  MessageAttachment,
  SessionRecord,
} from "@chief/agent-runtime/types";

import type { WorkspaceAgentId } from "../../lib/workspace-channels";
import type { ConversationAuxiliaryPanelSizing } from "./conversation-auxiliary-panel";
import type { ConversationProfileSelection } from "./conversation-profile";

/** Configuration and host callbacks for the composed Chief chat surface. */
export interface ChiefChatProps {
  chatId: string;
  /** True for a draft chat with no persisted transcript to replay. */
  isNew?: boolean;
  /** Guided inline setup rendered above the message box. */
  composer?: "recurring" | "oneoff";
  /** Prefilled date (YYYY-MM-DD) for the one-off composer. */
  composerDate?: string;
  /** Prefilled playbook for recurring work. */
  composerPlaybookId?: string;
  initialPrompt?: string;
  initialAttachments?: readonly MessageAttachment[];
  initialDraft?: string;
  initialMessageId?: string;
  initialThreadRootId?: string;
  focusComposer?: boolean;
  initialDriver?: DriverType;
  initialModel?: string;
  channel?: {
    label: string;
    description: string;
    agentIds: readonly string[];
  };
  directAgent?: { id: WorkspaceAgentId; name: string; role: string };
  destinationChannelId?: string;
  integrationDomain?: string;
  activeChild?: SessionRecord;
  onInitialPromptSent?: () => void;
  onCloseChild?: (returnThreadRootId?: string) => void;
  onOpenChild?: (childId: string) => void;
  onThreadRootChange?: (threadRootId: string | null) => void;
  onOpenProfile?: (selection: ConversationProfileSelection) => void;
  onOpenInternalPanel?: () => void;
  activityOpen: boolean;
  onActivityOpenChange: (open: boolean) => void;
  panelSizing: ConversationAuxiliaryPanelSizing;
  profileOpen?: boolean;
  /** Conversation chrome belongs to the main split pane so auxiliary headers
   * can align across the full-height divider. */
  header?: ReactNode;
}
