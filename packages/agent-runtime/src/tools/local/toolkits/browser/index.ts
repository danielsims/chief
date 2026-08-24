import { clickBrowserTool } from "./click-browser.js";
import { closeBrowserTool } from "./close-browser.js";
import { fillBrowserTool } from "./fill-browser.js";
import { openBrowserTool } from "./open-browser.js";
import { presentBrowserTool } from "./present-browser.js";
import { pressBrowserTool } from "./press-browser.js";
import { selectBrowserTool } from "./select-browser.js";
import { snapshotBrowserTool } from "./snapshot-browser.js";

export const browserToolkit = [
  openBrowserTool,
  snapshotBrowserTool,
  closeBrowserTool,
  presentBrowserTool,
  clickBrowserTool,
  fillBrowserTool,
  selectBrowserTool,
  pressBrowserTool,
] as const;
