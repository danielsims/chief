import type {
  BrowserAutomationCommand,
  BrowserAutomationResult,
} from "../../../../browser-types.js";
import type { BrowserPresentationMode } from "../../../../types.js";

export interface BrowserLocalToolContext {
  openBrowser?: (
    conversationId: string,
    url: string,
    fresh: boolean,
    browserRunId?: string,
  ) => string | Promise<string>;
  browserCommand?: (
    conversationId: string,
    command: BrowserAutomationCommand,
    browserRunId?: string,
  ) => Promise<BrowserAutomationResult>;
  closeBrowser?: (
    conversationId: string,
    browserRunId?: string,
  ) => void | Promise<void>;
  presentBrowser?: (
    conversationId: string,
    mode: BrowserPresentationMode,
    browserRunId?: string,
  ) => void | Promise<void>;
}
