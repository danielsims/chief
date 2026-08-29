import { clickBrowserTool } from "../../runtime/browser/click-browser.js";
import { closeBrowserTool } from "../../runtime/browser/close-browser.js";
import { fillBrowserTool } from "../../runtime/browser/fill-browser.js";
import { openBrowserTool } from "../../runtime/browser/open-browser.js";
import { presentBrowserTool } from "../../runtime/browser/present-browser.js";
import { pressBrowserTool } from "../../runtime/browser/press-browser.js";
import { selectBrowserTool } from "../../runtime/browser/select-browser.js";
import { snapshotBrowserTool } from "../../runtime/browser/snapshot-browser.js";

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
