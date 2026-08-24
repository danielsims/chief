import type { ChannelLocalToolContext } from "./channel-local-tools.js";
import type { ScheduledWorkRunner } from "./scheduled-work-local-tools.js";
import type { BrowserLocalToolContext } from "./tools/local/toolkits/browser/context.js";
import type { IntegrationSetupLocalToolContext } from "./tools/local/toolkits/integrations/context.js";
import type { PluginLocalToolService } from "./tools/local/toolkits/plugins/context.js";
import type { ProjectLocalToolContext } from "./tools/local/toolkits/projects/context.js";
import type { WorkspaceFileRecord } from "./types.js";

export type LocalToolContext = BrowserLocalToolContext & {
  channels?: ChannelLocalToolContext;
  integrationSetup?: IntegrationSetupLocalToolContext;
  scheduledWork?: ScheduledWorkRunner;
  conversationId?: string;
  onActivity?: () => void | Promise<void>;
  onFilesChanged?: () => void | Promise<void>;
  onFileWritten?: (file: WorkspaceFileRecord) => void | Promise<void>;
  activateIntegrationSetup?: (
    sessionId: string,
    attemptId: string,
    domain: string,
  ) => void | Promise<void>;
  startSetup?: (
    sessionId: string,
    domain: string,
  ) => Promise<{
    attemptId: string;
    domain: string;
    label: string;
    instructions: string;
    available: { id: string; domain: string; label: string }[];
  }>;
  listSetupTasks?: () => Promise<
    { id: string; domain: string; label: string }[]
  >;
  plugins?: PluginLocalToolService;
  projects?: ProjectLocalToolContext;
};
