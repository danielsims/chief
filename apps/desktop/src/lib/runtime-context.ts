import type {
  AgentDefinition,
  IntegrationSetupProgress,
} from "@chief/agent-runtime/types";

import type {
  RuntimeBrowserRuns,
  RuntimeBrowserSessions,
} from "./browser-sessions";
import type {
  RuntimeConnectionStatus,
  RuntimeTransport,
} from "./runtime-transport";

export type RuntimeStatus = RuntimeConnectionStatus;

export interface RuntimeContextValue {
  client: RuntimeTransport;
  status: RuntimeStatus;
  agents: AgentDefinition[];
  browserSessions: RuntimeBrowserSessions;
  browserRuns: RuntimeBrowserRuns;
  anchorBrowserSession: (browserRunId: string, messageId: string) => void;
  integrationSetupProgress: Readonly<Record<string, IntegrationSetupProgress>>;
  openBrowser: (
    url: string,
    conversationId?: string,
    options?: {
      browserRunId?: string;
      threadRootId?: string;
      anchorMessageId?: string;
    },
  ) => void;
  reportBrowserUrl: (browserRunId: string, url: string) => void;
  reloadBrowser: (browserRunId: string) => void;
  takeBrowserControl: (browserRunId: string) => void;
  closeBrowser: (browserRunId: string) => void;
}
