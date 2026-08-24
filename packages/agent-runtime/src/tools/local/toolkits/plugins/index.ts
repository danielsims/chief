import { authorizePluginTool } from "./authorize-plugin.js";
import { installPluginTool } from "./install-plugin.js";
import { listPluginsTool } from "./list-plugins.js";
import { recommendPluginsTool } from "./recommend-plugins.js";
import { uninstallPluginTool } from "./uninstall-plugin.js";

export const pluginsToolkit = [
  recommendPluginsTool,
  listPluginsTool,
  installPluginTool,
  authorizePluginTool,
  uninstallPluginTool,
] as const;
