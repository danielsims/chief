import type { RelayClient } from "@chief/relay-client";
import type {
  CreateWorkspaceCommand,
  WorkspaceInvite,
  WorkspaceInviteClaimResult,
  WorkspaceSnapshot,
  WorkspaceSummary,
} from "@chief/relay-contracts";

export interface RelaySessionValue {
  client: RelayClient | null;
  snapshot: WorkspaceSnapshot | null;
  workspaces: WorkspaceSummary[];
  loading: boolean;
  error: string | null;
  recoveryWorkspace: WorkspaceSummary | null;
  refresh: () => Promise<void>;
  returnToPreviousWorkspace: () => Promise<void>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  switchWorkspace: (
    workspaceId: string,
    target?: { relayUrl: string; accountId: string },
  ) => Promise<void>;
  createWorkspace: (
    command: CreateWorkspaceCommand,
    apiKey?: string,
  ) => Promise<WorkspaceSnapshot>;
  previewWorkspaceInvite: (
    workspaceId: string,
    secret: string,
  ) => Promise<WorkspaceInvite>;
  claimWorkspaceInvite: (
    workspaceId: string,
    secret: string,
  ) => Promise<WorkspaceInviteClaimResult>;
}
